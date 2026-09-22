import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { students, users } from "../db/schema.js";

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function displayName(name: string | null | undefined, email: string) {
  const trimmed = name?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : email.split("@")[0]).slice(0, 160);
}

/** Conta já existente (equipe ou aluno) entra; senão cria aluno + user ligados ao Google. */
export async function ensureAppUserFromOAuth(profile: {
  email: string;
  name?: string | null;
}) {
  const email = normalizeEmail(profile.email);
  if (!email) {
    throw new Error("E-mail Google ausente");
  }
  const name = displayName(profile.name, email);

  const existing = await db.query.users.findFirst({
    where: (fields) => sql`lower(${fields.email}) = ${email}`,
  });
  if (existing) return existing;

  try {
    return await db.transaction(async (tx) => {
      const [again] = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (again) return again;

      const [crm] = await tx
        .select()
        .from(students)
        .where(sql`lower(${students.email}) = ${email}`)
        .limit(1);

      const student =
        crm ??
        (
          await tx
            .insert(students)
            .values({
              name,
              email,
              entryDate: new Date().toISOString().slice(0, 10),
              origin: "Google",
              status: "Ativo",
              appAccess: true,
            })
            .returning()
        )[0];

      if (crm && !crm.appAccess) {
        await tx
          .update(students)
          .set({ appAccess: true, updatedAt: new Date() })
          .where(eq(students.id, student.id));
      }

      const [created] = await tx
        .insert(users)
        .values({
          name,
          email,
          passwordHash: null,
          role: "STUDENT",
          studentId: student.id,
          active: true,
        })
        .returning();

      return created;
    });
  } catch (err) {
    const raced = await db.query.users.findFirst({
      where: (fields) => sql`lower(${fields.email}) = ${email}`,
    });
    if (raced) return raced;
    throw err;
  }
}

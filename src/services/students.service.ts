import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { plans, students } from "../db/schema.js";
import { todayInRecife } from "../domain/billing-status.js";
import { decryptField, encryptField } from "../lib/encryption.js";
import type { JwtPayload } from "../types/auth.js";

export type StudentInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  sex?: string | null;
  birthdate?: string | null;
  city?: string | null;
  state?: string | null;
  goal?: string | null;
  restrictions?: string | null;
  planId?: string | null;
  trainerId?: string | null;
  value?: string | null;
  status?: "Ativo" | "Pausado" | "Inadimplente" | "Cancelado" | "Pendente";
  entryDate: string;
  renewDate?: string | null;
  cancelDate?: string | null;
  origin?: string | null;
  priority?: string | null;
  heightCm?: number | null;
};

function mapStudent(row: typeof students.$inferSelect, planName: string | null = null) {
  let restrictions: string | null = null;
  if (row.restrictionsEncrypted) {
    try {
      restrictions = decryptField(row.restrictionsEncrypted);
    } catch {
      restrictions = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    instagram: row.instagram,
    sex: row.sex,
    birthdate: row.birthdate,
    city: row.city,
    state: row.state,
    goal: row.goal,
    restrictions,
    planId: row.planId,
    planName,
    trainerId: row.trainerId,
    value: row.value,
    status: row.status,
    entryDate: row.entryDate,
    renewDate: row.renewDate,
    cancelDate: row.cancelDate,
    origin: row.origin,
    priority: row.priority,
    engagement: row.engagement,
    adherence: row.adherence,
    risk: row.risk,
    heightCm: row.heightCm,
    monthlyWeight: row.monthlyWeight,
    lastCheckin: row.lastCheckin,
    lastBiofeedback: row.lastBiofeedback,
    appAccess: row.appAccess,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** IDOR prevention: trainers only see assigned students; students only themselves */
export function studentAccessFilter(user: JwtPayload): SQL | undefined {
  if (user.role === "ADMIN" || user.role === "FINANCE" || user.role === "RECEPTION") {
    return undefined;
  }
  if (user.role === "TRAINER") {
    return eq(students.trainerId, user.sub);
  }
  if (user.role === "STUDENT" && user.studentId) {
    return eq(students.id, user.studentId);
  }
  return eq(students.id, "00000000-0000-0000-0000-000000000000");
}

export async function listStudents(
  user: JwtPayload,
  opts: { q?: string; status?: string; limit?: number; offset?: number },
) {
  const filters: SQL[] = [];
  const access = studentAccessFilter(user);
  if (access) filters.push(access);

  if (opts.status) {
    filters.push(eq(students.status, opts.status as typeof students.$inferSelect.status));
  }
  if (opts.q) {
    const term = `%${opts.q}%`;
    filters.push(or(ilike(students.name, term), ilike(students.email, term))!);
  }

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select({ student: students, planName: plans.name })
    .from(students)
    .leftJoin(plans, eq(students.planId, plans.id))
    .where(where)
    .orderBy(desc(students.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);

  return rows.map((row) => mapStudent(row.student, row.planName));
}

async function planNameOf(planId: string | null): Promise<string | null> {
  if (!planId) return null;
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
    columns: { name: true },
  });
  return plan?.name ?? null;
}

export async function getStudentById(user: JwtPayload, id: string) {
  const access = studentAccessFilter(user);
  const row = await db.query.students.findFirst({
    where: access ? and(eq(students.id, id), access) : eq(students.id, id),
  });
  return row ? mapStudent(row, await planNameOf(row.planId)) : null;
}

export async function createStudent(input: StudentInput) {
  const [row] = await db
    .insert(students)
    .values({
      name: input.name.trim(),
      phone: input.phone ?? null,
      email: input.email?.toLowerCase().trim() ?? null,
      instagram: input.instagram ?? null,
      sex: input.sex ?? null,
      birthdate: input.birthdate ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      goal: input.goal ?? null,
      restrictionsEncrypted: input.restrictions ? encryptField(input.restrictions) : null,
      planId: input.planId ?? null,
      trainerId: input.trainerId ?? null,
      value: input.value ?? null,
      status: input.status ?? "Ativo",
      entryDate: input.entryDate,
      renewDate: input.renewDate ?? null,
      cancelDate: input.cancelDate ?? null,
      origin: input.origin ?? null,
      priority: input.priority ?? "Média",
      heightCm: input.heightCm ?? null,
    })
    .returning();

  return mapStudent(row, await planNameOf(row.planId));
}

export async function updateStudent(user: JwtPayload, id: string, input: Partial<StudentInput>) {
  const existing = await getStudentById(user, id);
  if (!existing) return null;

  const [row] = await db
    .update(students)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email?.toLowerCase().trim() ?? null } : {}),
      ...(input.instagram !== undefined ? { instagram: input.instagram } : {}),
      ...(input.sex !== undefined ? { sex: input.sex } : {}),
      ...(input.birthdate !== undefined ? { birthdate: input.birthdate } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.restrictions !== undefined
        ? {
            restrictionsEncrypted: input.restrictions ? encryptField(input.restrictions) : null,
          }
        : {}),
      ...(input.planId !== undefined ? { planId: input.planId } : {}),
      ...(input.trainerId !== undefined ? { trainerId: input.trainerId } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.status === "Pausado" || input.status === "Cancelado" || input.status === "Pendente"
        ? {
            status: input.status,
            appAccess: false,
            ...(input.status === "Cancelado"
              ? { cancelDate: input.cancelDate ?? todayInRecife() }
              : {}),
          }
        : input.status === "Ativo" || input.status === "Inadimplente"
          ? { status: "Ativo" as const, appAccess: true }
          : {}),
      ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
      ...(input.renewDate !== undefined ? { renewDate: input.renewDate } : {}),
      ...(input.cancelDate !== undefined && input.status !== "Cancelado"
        ? { cancelDate: input.cancelDate }
        : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      updatedAt: new Date(),
    })
    .where(eq(students.id, id))
    .returning();

  return row ? mapStudent(row, await planNameOf(row.planId)) : null;
}

export async function deleteStudent(user: JwtPayload, id: string) {
  const existing = await getStudentById(user, id);
  if (!existing) return false;
  await db.delete(students).where(eq(students.id, id));
  return true;
}

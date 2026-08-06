import { eq } from "drizzle-orm";
import { env } from "../lib/env.js";
import { hashPassword } from "../services/auth.service.js";
import { db } from "./index.js";
import { plans, students, users } from "./schema.js";
import { encryptField } from "../lib/encryption.js";

async function seed() {
  const email = (env.SEED_ADMIN_EMAIL ?? "admin@nexusscience.local").toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD ?? "ChangeMeAdmin123!";
  const name = env.SEED_ADMIN_NAME ?? "Abner Lucas";

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!existing) {
    await db.insert(users).values({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      active: true,
    });
    console.log(`Admin criado: ${email}`);
  } else {
    console.log(`Admin já existe: ${email}`);
  }

  const planCount = await db.select().from(plans).limit(1);
  if (planCount.length === 0) {
    const inserted = await db
      .insert(plans)
      .values([
        {
          name: "Bronze",
          tier: "Bronze",
          value: "147.00",
          benefits: ["Treino mensal", "Suporte WhatsApp"],
        },
        {
          name: "Silver",
          tier: "Silver",
          value: "297.00",
          benefits: ["Treino quinzenal", "Biofeedback", "Suporte prioritário"],
        },
        {
          name: "Gold",
          tier: "Gold",
          value: "497.00",
          benefits: ["Treino semanal", "Avaliação física", "IA Insights"],
        },
      ])
      .returning();
    console.log(`Planos criados: ${inserted.map((p) => p.name).join(", ")}`);
  }

  const studentCount = await db.select().from(students).limit(1);
  if (studentCount.length === 0) {
    const allPlans = await db.select().from(plans);
    const silver = allPlans.find((p) => p.tier === "Silver");
    const gold = allPlans.find((p) => p.tier === "Gold");
    const bronze = allPlans.find((p) => p.tier === "Bronze");

    await db.insert(students).values([
      {
        name: "Oliver",
        phone: "11999881234",
        email: "oliver@email.com",
        instagram: "@oliver",
        sex: "M",
        birthdate: "1995-03-15",
        city: "São Paulo",
        state: "SP",
        goal: "Hipertrofia",
        planId: silver?.id,
        value: "297.00",
        status: "Ativo",
        entryDate: "2024-01-10",
        renewDate: "2026-07-10",
        origin: "Instagram",
        priority: "Alta",
        engagement: 87,
        adherence: 88,
        risk: 15,
        heightCm: 165,
        monthlyWeight: "68.50",
        restrictionsEncrypted: encryptField("Nenhuma"),
      },
      {
        name: "Bruno Mendes Costa",
        phone: "21988776655",
        email: "bruno@email.com",
        city: "Rio de Janeiro",
        state: "RJ",
        goal: "Hipertrofia",
        planId: gold?.id,
        value: "497.00",
        status: "Ativo",
        entryDate: "2023-08-05",
        engagement: 92,
        adherence: 95,
        risk: 8,
        heightCm: 182,
        monthlyWeight: "92.00",
        restrictionsEncrypted: encryptField("Lombalgia leve"),
      },
      {
        name: "Carla Fernanda Ramos",
        phone: "31977665544",
        email: "carla@email.com",
        city: "Belo Horizonte",
        state: "MG",
        goal: "Condicionamento",
        planId: bronze?.id,
        value: "147.00",
        status: "Inadimplente",
        entryDate: "2024-03-20",
        engagement: 41,
        adherence: 52,
        risk: 78,
        heightCm: 163,
        monthlyWeight: "61.00",
        appAccess: false,
        restrictionsEncrypted: encryptField("Nenhuma"),
      },
    ]);
    console.log("Alunos de demonstração criados");
  }

  console.log("Seed concluído.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

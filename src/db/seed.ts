import { eq } from "drizzle-orm";
import { env } from "../lib/env.js";
import { hashPassword } from "../services/auth.service.js";
import { db } from "./index.js";
import {
  biofeedback,
  plans,
  students,
  trainingRoutines,
  trainings,
  transactions,
  users,
} from "./schema.js";
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
          checkoutUrl: "https://patitor.dev/checkout/bronze",
        },
        {
          name: "Silver",
          tier: "Silver",
          value: "297.00",
          benefits: ["Treino quinzenal", "Biofeedback", "Suporte prioritário"],
          checkoutUrl: "https://patitor.dev/checkout/silver",
        },
        {
          name: "Gold",
          tier: "Gold",
          value: "497.00",
          benefits: ["Treino semanal", "Avaliação física", "IA Insights"],
          checkoutUrl: "https://patitor.dev/checkout/gold",
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
        lastBiofeedback: new Date().toISOString().slice(0, 10),
        lastCheckin: new Date().toISOString().slice(0, 10),
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
        lastBiofeedback: new Date().toISOString().slice(0, 10),
        lastCheckin: new Date().toISOString().slice(0, 10),
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

  const allStudents = await db.select().from(students);
  const oliver = allStudents.find((s) => s.name === "Oliver");

  const txCount = await db.select().from(transactions).limit(1);
  if (txCount.length === 0) {
    const months = [
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ];
    await db.insert(transactions).values(
      months.flatMap((date, i) => [
        {
          type: "RECEITA" as const,
          category: "Mensalidades",
          description: `Receita ${date.slice(0, 7)}`,
          amount: String(1800 + i * 120),
          date,
        },
        {
          type: "DESPESA" as const,
          category: "Marketing",
          description: `Ads ${date.slice(0, 7)}`,
          amount: String(200 + i * 15),
          date,
        },
        {
          type: "DESPESA" as const,
          category: "Operacional",
          description: `Custos ${date.slice(0, 7)}`,
          amount: "450.00",
          date,
        },
      ]),
    );
    console.log("Transações de demonstração criadas");
  }

  const bioCount = await db.select().from(biofeedback).limit(1);
  if (bioCount.length === 0 && oliver) {
    const entries = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      entries.push({
        studentId: oliver.id,
        date: d.toISOString().slice(0, 10),
        energy: 6 + (i % 4),
        mood: 6 + (i % 3),
        stress: 3 + (i % 4),
        sleep: 6 + (i % 3),
        sleepHours: String(6.5 + (i % 3) * 0.5),
        hydration: String(2.5 + (i % 3) * 0.3),
        musclePain: 2 + (i % 5),
        weight: "68.50",
        heightCm: 165,
      });
    }
    await db.insert(biofeedback).values(entries);
    console.log("Biofeedback de demonstração criado");
  }

  const routineCount = await db.select().from(trainingRoutines).limit(1);
  if (routineCount.length === 0 && oliver) {
    const [routine] = await db
      .insert(trainingRoutines)
      .values({
        studentId: oliver.id,
        name: "Rotina Hipertrofia ABC",
        objective: "Ganho de massa e força",
        frequency: 5,
        startDate: "2026-06-01",
        status: "Ativa",
        totalSessions: 36,
        completedSessions: 12,
      })
      .returning();

    await db.insert(trainings).values([
      {
        routineId: routine.id,
        code: "A",
        name: "Treino A",
        focus: "Membros Inferiores",
        dayOfWeek: "Segunda",
        duration: "50 min",
        exercises: [
          {
            name: "Agachamento Livre",
            group: "Quadríceps",
            sets: 4,
            reps: "12",
            load: 60,
            cadence: "2-1-2",
            rest: "60s",
          },
          {
            name: "Leg Press 45°",
            group: "Quadríceps",
            sets: 4,
            reps: "15",
            load: 120,
            rest: "60s",
          },
          {
            name: "Mesa Flexora",
            group: "Isquiotibiais",
            sets: 3,
            reps: "12",
            load: 35,
            rest: "45s",
          },
        ],
      },
      {
        routineId: routine.id,
        code: "B",
        name: "Treino B",
        focus: "Peito / Tríceps",
        dayOfWeek: "Quarta",
        duration: "45 min",
        exercises: [
          { name: "Supino Reto", group: "Peitoral", sets: 4, reps: "10", load: 50, rest: "90s" },
          { name: "Crucifixo", group: "Peitoral", sets: 3, reps: "12", load: 14, rest: "60s" },
          { name: "Tríceps Corda", group: "Tríceps", sets: 3, reps: "15", load: 25, rest: "45s" },
        ],
      },
    ]);
    console.log("Rotina de treino de demonstração criada");
  }

  console.log("Seed concluído.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

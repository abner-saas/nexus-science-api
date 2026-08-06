import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  numeric,
  date,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "TRAINER",
  "FINANCE",
  "RECEPTION",
  "STUDENT",
]);

export const studentStatusEnum = pgEnum("student_status", [
  "Ativo",
  "Pausado",
  "Inadimplente",
  "Cancelado",
]);

export const planTierEnum = pgEnum("plan_tier", ["Bronze", "Silver", "Gold", "Custom"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "CONFIRMED",
  "OVERDUE",
  "REFUNDED",
  "CANCELLED",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["PIX", "CREDIT_CARD", "BOLETO"]);

export const transactionTypeEnum = pgEnum("transaction_type", ["RECEITA", "DESPESA"]);

export const sessionStatusEnum = pgEnum("session_status", [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "MISSED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("TRAINER"),
    active: boolean("active").notNull().default(true),
    studentId: uuid("student_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_uidx").on(t.email),
  }),
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("refresh_tokens_user_idx").on(t.userId),
    tokenIdx: uniqueIndex("refresh_tokens_hash_uidx").on(t.tokenHash),
  }),
);

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  tier: planTierEnum("tier").notNull().default("Custom"),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  benefits: jsonb("benefits").$type<string[]>().default([]),
  checkoutUrl: text("checkout_url"),
  asaasProductId: varchar("asaas_product_id", { length: 80 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const students = pgTable(
  "students",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    instagram: varchar("instagram", { length: 80 }),
    sex: varchar("sex", { length: 1 }),
    birthdate: date("birthdate"),
    city: varchar("city", { length: 80 }),
    state: varchar("state", { length: 2 }),
    goal: varchar("goal", { length: 120 }),
    /** Encrypted at rest — medical notes / injuries (LGPD) */
    restrictionsEncrypted: text("restrictions_encrypted"),
    planId: uuid("plan_id").references(() => plans.id),
    trainerId: uuid("trainer_id").references(() => users.id),
    value: numeric("value", { precision: 12, scale: 2 }),
    status: studentStatusEnum("status").notNull().default("Ativo"),
    entryDate: date("entry_date").notNull(),
    renewDate: date("renew_date"),
    cancelDate: date("cancel_date"),
    origin: varchar("origin", { length: 60 }),
    priority: varchar("priority", { length: 20 }).default("Média"),
    engagement: smallint("engagement").default(0),
    adherence: smallint("adherence").default(0),
    risk: smallint("risk").default(0),
    heightCm: smallint("height_cm"),
    monthlyWeight: numeric("monthly_weight", { precision: 5, scale: 2 }),
    lastCheckin: date("last_checkin"),
    lastBiofeedback: date("last_biofeedback"),
    asaasCustomerId: varchar("asaas_customer_id", { length: 80 }),
    appAccess: boolean("app_access").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("students_status_idx").on(t.status),
    trainerIdx: index("students_trainer_idx").on(t.trainerId),
    emailIdx: index("students_email_idx").on(t.email),
    entryIdx: index("students_entry_date_idx").on(t.entryDate),
  }),
);

export const trainingRoutines = pgTable(
  "training_routines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    objective: text("objective"),
    frequency: smallint("frequency").notNull().default(3),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: varchar("status", { length: 40 }).notNull().default("Ativa"),
    totalSessions: integer("total_sessions").default(0),
    completedSessions: integer("completed_sessions").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    studentIdx: index("routines_student_idx").on(t.studentId),
  }),
);

export const trainings = pgTable(
  "trainings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => trainingRoutines.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 8 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    focus: varchar("focus", { length: 120 }),
    dayOfWeek: varchar("day_of_week", { length: 20 }),
    duration: varchar("duration", { length: 40 }),
    /** Flexible exercise list: sets/reps/load/cadence/rest */
    exercises: jsonb("exercises")
      .$type<
        Array<{
          id?: string;
          name: string;
          group: string;
          sets: number;
          reps: string;
          load?: number;
          cadence?: string;
          rest?: string;
          technique?: string;
          notes?: string;
        }>
      >()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    routineIdx: index("trainings_routine_idx").on(t.routineId),
  }),
);

export const exerciseLibrary = pgTable("exercise_library", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  muscleGroup: varchar("muscle_group", { length: 80 }).notNull(),
  instructions: text("instructions"),
  mediaUrl: text("media_url"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    trainingId: uuid("training_id").references(() => trainings.id),
    routineId: uuid("routine_id").references(() => trainingRoutines.id),
    date: date("date").notNull(),
    status: sessionStatusEnum("status").notNull().default("SCHEDULED"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    studentDateIdx: index("sessions_student_date_idx").on(t.studentId, t.date),
  }),
);

export const biofeedback = pgTable(
  "biofeedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    energy: smallint("energy"),
    mood: smallint("mood"),
    stress: smallint("stress"),
    sleep: smallint("sleep"),
    sleepHours: numeric("sleep_hours", { precision: 4, scale: 1 }),
    hydration: numeric("hydration", { precision: 4, scale: 1 }),
    musclePain: smallint("muscle_pain"),
    weight: numeric("weight", { precision: 5, scale: 2 }),
    heightCm: smallint("height_cm"),
    calories: integer("calories"),
    hr: smallint("hr"),
    steps: integer("steps"),
    aiInsight: text("ai_insight"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    studentDateIdx: uniqueIndex("biofeedback_student_date_uidx").on(t.studentId, t.date),
    dateIdx: index("biofeedback_date_idx").on(t.date),
  }),
);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    weight: numeric("weight", { precision: 5, scale: 2 }),
    heightCm: smallint("height_cm"),
    bmi: numeric("bmi", { precision: 4, scale: 1 }),
    bodyFat: numeric("body_fat", { precision: 4, scale: 1 }),
    muscle: numeric("muscle", { precision: 5, scale: 1 }),
    waist: numeric("waist", { precision: 5, scale: 1 }),
    hip: numeric("hip", { precision: 5, scale: 1 }),
    thigh: numeric("thigh", { precision: 5, scale: 1 }),
    arm: numeric("arm", { precision: 5, scale: 1 }),
    /** Photo URLs in S3/Supabase Storage — never Base64 in DB */
    photoUrls: jsonb("photo_urls").$type<string[]>().default([]),
    notesEncrypted: text("notes_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    studentDateIdx: index("assessments_student_date_idx").on(t.studentId, t.date),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: paymentMethodEnum("method"),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    dueDate: date("due_date").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    checkoutUrl: text("checkout_url"),
    asaasPaymentId: varchar("asaas_payment_id", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    studentIdx: index("payments_student_idx").on(t.studentId),
    statusIdx: index("payments_status_idx").on(t.status),
    dueIdx: index("payments_due_date_idx").on(t.dueDate),
    asaasIdx: uniqueIndex("payments_asaas_uidx").on(t.asaasPaymentId),
  }),
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: transactionTypeEnum("type").notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    description: varchar("description", { length: 255 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    date: date("date").notNull(),
    studentId: uuid("student_id").references(() => students.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dateIdx: index("transactions_date_idx").on(t.date),
    typeIdx: index("transactions_type_idx").on(t.type),
  }),
);

/** Hourly-refreshed KPIs — avoid realtime LTV/CAC on every dashboard hit */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    date: date("date").notNull(),
    activeStudents: integer("active_students").default(0),
    mrr: numeric("mrr", { precision: 14, scale: 2 }).default("0"),
    revenue: numeric("revenue", { precision: 14, scale: 2 }).default("0"),
    expenses: numeric("expenses", { precision: 14, scale: 2 }).default("0"),
    profit: numeric("profit", { precision: 14, scale: 2 }).default("0"),
    retentionRate: numeric("retention_rate", { precision: 5, scale: 2 }).default("0"),
    churnRate: numeric("churn_rate", { precision: 5, scale: 2 }).default("0"),
    avgTicket: numeric("avg_ticket", { precision: 12, scale: 2 }).default("0"),
    avgLtv: numeric("avg_ltv", { precision: 12, scale: 2 }).default("0"),
    cac: numeric("cac", { precision: 12, scale: 2 }).default("0"),
    newStudents: integer("new_students").default(0),
    cancellations: integer("cancellations").default(0),
    overdueCount: integer("overdue_count").default(0),
    atRiskCount: integer("at_risk_count").default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dateIdx: uniqueIndex("daily_metrics_date_uidx").on(t.date),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index("audit_logs_created_idx").on(t.createdAt),
  }),
);

export const platformSettings = pgTable("platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessName: varchar("business_name", { length: 160 }).default("Nexus Science"),
  logoUrl: text("logo_url"),
  asaasConfigured: boolean("asaas_configured").default(false),
  collectionTemplates: jsonb("collection_templates"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const studentsRelations = relations(students, ({ one, many }) => ({
  plan: one(plans, { fields: [students.planId], references: [plans.id] }),
  trainer: one(users, { fields: [students.trainerId], references: [users.id] }),
  routines: many(trainingRoutines),
  biofeedback: many(biofeedback),
  assessments: many(assessments),
  payments: many(payments),
}));

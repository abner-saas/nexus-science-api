import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { type Database, db } from "../db/index.js";
import { payments, plans, students, users } from "../db/schema.js";
import { env } from "../lib/env.js";
import { type AsaasClient, AsaasRequestError, createAsaasClient } from "./asaas.client.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CheckoutCaller =
  | { kind: "lead"; email: string; name: string }
  | {
      kind: "student";
      userId: string;
      email: string;
      name: string;
      studentId: string | null;
    };

export type CheckoutSessionData = {
  studentId: string;
  paymentId: string;
  checkoutUrl: string;
  status: string;
};

export type CheckoutSessionResult =
  | { ok: true; statusCode: 200 | 201; data: CheckoutSessionData; notifyName: string | null }
  | {
      ok: false;
      statusCode: 403 | 404 | 502 | 503;
      error: "Forbidden" | "NotFound" | "BadGateway" | "AsaasNotConfigured";
      message: string;
    };

/**
 * `gateway: null` força o 503 (teste sem mexer no env).
 * Omitir usa `ASAAS_API_KEY`.
 */
export type CheckoutOptions = {
  gateway?: AsaasClient | null;
  log?: FastifyBaseLogger;
};

type StudentSnap = {
  id: string;
  status: string;
  name: string;
  email: string;
  phone: string | null;
  asaasCustomerId: string | null;
};

type Preview =
  | { kind: "new" }
  | { kind: "ready"; student: StudentSnap; paymentId: string; checkoutUrl: string }
  | { kind: "recover"; student: StudentSnap; paymentId: string; asaasPaymentId: string }
  | { kind: "legacy"; student: StudentSnap; paymentId: string }
  | { kind: "create"; student: StudentSnap };

type PlanSnap = { id: string; name: string; value: string };

/**
 * Abre (ou reaproveita) uma sessão de checkout criando a cobrança no Asaas.
 *
 * A URL devolvida é `invoiceUrl` da cobrança (`POST /v3/payments`), não
 * `plans.checkoutUrl`. Sem `ASAAS_API_KEY`, 503 e nenhuma row de payment.
 * `externalReference` da cobrança é o id local do payment; o webhook segue
 * achando por `payments.asaasPaymentId` (o id que a Asaas devolve).
 *
 * Idempotência: `payments` não tem `planId`. A janela de 24h casa o aluno
 * cujo `planId` já é o plano pedido. PENDING com `asaasPaymentId` e URL
 * https devolve 200. PENDING sem id (link estático do slice anterior) ganha
 * a cobrança na mesma row.
 */
export async function openCheckoutSession(
  caller: CheckoutCaller,
  planId: string,
  options?: CheckoutOptions,
): Promise<CheckoutSessionResult> {
  try {
    return await openCheckoutOnce(caller, planId, options);
  } catch (err) {
    if (caller.kind !== "lead" || !isUniqueViolation(err)) throw err;
    const raced = await findUserByEmail(caller.email);
    if (!raced) throw err;
    if (raced.role !== "STUDENT") return forbidden();
    return openCheckoutOnce(
      {
        kind: "student",
        userId: raced.id,
        email: raced.email,
        name: raced.name,
        studentId: raced.studentId,
      },
      planId,
      options,
    );
  }
}

async function openCheckoutOnce(
  caller: CheckoutCaller,
  planId: string,
  options?: CheckoutOptions,
): Promise<CheckoutSessionResult> {
  const plan = await loadActivePlan(planId);
  if (!plan) return notFound();

  const today = todayInRecife();
  const preview = await readPreview(caller, plan.id);
  if (preview.kind === "ready") return readyResult(preview);

  const gateway = resolveGateway(options);
  if (!gateway) return notConfigured();

  const student = await ensureStudent(preview, caller, plan, today);
  try {
    if (preview.kind === "recover") {
      return await recoverPayment(gateway, student, preview, plan, today);
    }
    const customerId = await ensureCustomer(gateway, student);
    return await createCharge(
      gateway,
      student,
      preview,
      caller,
      plan,
      today,
      customerId,
      options?.log,
    );
  } catch (err) {
    await forgetCustomerIfInvalid(err, student);
    return mapChargeError(err, options?.log);
  }
}

function resolveGateway(options?: CheckoutOptions): AsaasClient | null {
  if (options && "gateway" in options) return options.gateway ?? null;
  const apiKey = env.ASAAS_API_KEY?.trim();
  if (!apiKey) return null;
  return createAsaasClient({ apiKey, baseUrl: env.ASAAS_BASE_URL });
}

async function loadActivePlan(planId: string): Promise<PlanSnap | undefined> {
  const [plan] = await db
    .select({ id: plans.id, name: plans.name, value: plans.value })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.active, true)))
    .limit(1);
  return plan;
}

async function readPreview(caller: CheckoutCaller, planId: string): Promise<Preview> {
  return db.transaction(async (tx) => {
    const row = await loadCallerStudent(tx, caller);
    if (!row) return { kind: "new" };
    const student = snapStudent(row, caller.email);
    if (row.planId !== planId) return { kind: "create", student };

    const pending = await findRecentPending(tx, row.id);
    if (!pending) return { kind: "create", student };
    const checkoutUrl = httpsUrl(pending.checkoutUrl);
    if (pending.asaasPaymentId && checkoutUrl) {
      return { kind: "ready", student, paymentId: pending.id, checkoutUrl };
    }
    if (pending.asaasPaymentId) {
      return {
        kind: "recover",
        student,
        paymentId: pending.id,
        asaasPaymentId: pending.asaasPaymentId,
      };
    }
    return { kind: "legacy", student, paymentId: pending.id };
  });
}

function readyResult(preview: Extract<Preview, { kind: "ready" }>): CheckoutSessionResult {
  return success({
    statusCode: 200,
    notifyName: null,
    studentId: preview.student.id,
    paymentId: preview.paymentId,
    checkoutUrl: preview.checkoutUrl,
    status: preview.student.status,
  });
}

async function ensureStudent(
  preview: Exclude<Preview, { kind: "ready" }>,
  caller: CheckoutCaller,
  plan: PlanSnap,
  today: string,
): Promise<StudentSnap> {
  if (preview.kind === "new") return createPendingStudent(caller, plan, today);
  await db
    .update(students)
    .set({ planId: plan.id, value: plan.value, updatedAt: new Date() })
    .where(eq(students.id, preview.student.id));
  return preview.student;
}

async function ensureCustomer(gateway: AsaasClient, student: StudentSnap): Promise<string> {
  if (student.asaasCustomerId) return student.asaasCustomerId;
  const found = await gateway.findCustomerIdByExternalReference(student.id);
  const created = found
    ? { id: found }
    : await gateway.createCustomer({
        name: student.name,
        ...(student.email ? { email: student.email } : {}),
        externalReference: student.id,
        ...asaasPhones(student.phone),
      });
  const id = requireAsaasId(created.id);
  await db
    .update(students)
    .set({ asaasCustomerId: id, updatedAt: new Date() })
    .where(eq(students.id, student.id));
  student.asaasCustomerId = id;
  return id;
}

async function recoverPayment(
  gateway: AsaasClient,
  student: StudentSnap,
  preview: Extract<Preview, { kind: "recover" }>,
  plan: PlanSnap,
  today: string,
): Promise<CheckoutSessionResult> {
  const charge = await gateway.getPayment(preview.asaasPaymentId);
  const checkoutUrl = httpsUrl(charge.invoiceUrl);
  if (!checkoutUrl) return badGateway();
  await writePayment({
    paymentId: preview.paymentId,
    studentId: student.id,
    amount: plan.value,
    dueDate: today,
    checkoutUrl,
    asaasPaymentId: requireAsaasId(charge.id),
    updateExisting: true,
  });
  return success({
    statusCode: 200,
    notifyName: null,
    studentId: student.id,
    paymentId: preview.paymentId,
    checkoutUrl,
    status: student.status,
  });
}

async function createCharge(
  gateway: AsaasClient,
  student: StudentSnap,
  preview: Exclude<Preview, { kind: "ready" | "recover" }>,
  caller: CheckoutCaller,
  plan: PlanSnap,
  today: string,
  customerId: string,
  log?: FastifyBaseLogger,
): Promise<CheckoutSessionResult> {
  const updateExisting = preview.kind === "legacy";
  const paymentId = preview.kind === "legacy" ? preview.paymentId : randomUUID();
  const created = await gateway.createPayment({
    customer: customerId,
    billingType: "UNDEFINED",
    value: asaasValue(plan.value),
    dueDate: today,
    description: `Mensalidade ${plan.name}`.slice(0, 500),
    externalReference: paymentId,
  });
  const asaasPaymentId = requireAsaasId(created.id);
  const checkoutUrl =
    httpsUrl(created.invoiceUrl) ?? (await fetchInvoiceUrl(gateway, asaasPaymentId, log));
  await writePayment({
    paymentId,
    studentId: student.id,
    amount: plan.value,
    dueDate: today,
    checkoutUrl,
    asaasPaymentId,
    updateExisting,
  });
  if (!checkoutUrl) return badGateway();
  return success({
    statusCode: updateExisting ? 200 : 201,
    notifyName: updateExisting ? null : caller.name,
    studentId: student.id,
    paymentId,
    checkoutUrl,
    status: student.status,
  });
}

async function fetchInvoiceUrl(
  gateway: AsaasClient,
  asaasPaymentId: string,
  log?: FastifyBaseLogger,
): Promise<string | null> {
  try {
    const fetched = await gateway.getPayment(asaasPaymentId);
    return httpsUrl(fetched.invoiceUrl);
  } catch (err) {
    if (err instanceof AsaasRequestError) logAsaas(log, err);
    else throw err;
    return null;
  }
}

async function writePayment(input: {
  paymentId: string;
  studentId: string;
  amount: string;
  dueDate: string;
  checkoutUrl: string | null;
  asaasPaymentId: string;
  updateExisting: boolean;
}) {
  if (input.updateExisting) {
    const [row] = await db
      .update(payments)
      .set({
        amount: input.amount,
        dueDate: input.dueDate,
        checkoutUrl: input.checkoutUrl,
        asaasPaymentId: input.asaasPaymentId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, input.paymentId))
      .returning({ id: payments.id });
    if (!row) throw new Error("Cobrança local do checkout não encontrada");
    return;
  }

  await db.insert(payments).values({
    id: input.paymentId,
    studentId: input.studentId,
    amount: input.amount,
    method: null,
    status: "PENDING",
    dueDate: input.dueDate,
    checkoutUrl: input.checkoutUrl,
    asaasPaymentId: input.asaasPaymentId,
  });
}

async function loadCallerStudent(tx: Tx, caller: CheckoutCaller) {
  if (caller.kind !== "student" || !caller.studentId) return undefined;
  const [row] = await tx.select().from(students).where(eq(students.id, caller.studentId)).limit(1);
  return row;
}

async function findRecentPending(tx: Tx, studentId: string) {
  const since = new Date(Date.now() - PENDING_WINDOW_MS);
  const [row] = await tx
    .select({
      id: payments.id,
      checkoutUrl: payments.checkoutUrl,
      asaasPaymentId: payments.asaasPaymentId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.studentId, studentId),
        eq(payments.status, "PENDING"),
        gte(payments.createdAt, since),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row;
}

async function createPendingStudent(caller: CheckoutCaller, plan: PlanSnap, today: string) {
  return db.transaction(async (tx) => {
    const [student] = await tx
      .insert(students)
      .values({
        name: caller.name,
        email: caller.email,
        planId: plan.id,
        value: plan.value,
        status: "Pendente",
        entryDate: today,
        origin: "checkout",
        appAccess: false,
      })
      .returning({ id: students.id });
    if (!student) throw new Error("Falha ao criar aluno do checkout");

    if (caller.kind === "lead") {
      await tx.insert(users).values({
        name: caller.name,
        email: caller.email,
        passwordHash: null,
        role: "STUDENT",
        active: true,
        studentId: student.id,
      });
    } else {
      await tx
        .update(users)
        .set({ studentId: student.id, updatedAt: new Date() })
        .where(eq(users.id, caller.userId));
    }

    return {
      id: student.id,
      status: "Pendente",
      name: caller.name,
      email: caller.email,
      phone: null,
      asaasCustomerId: null,
    } satisfies StudentSnap;
  });
}

async function forgetCustomerIfInvalid(err: unknown, student: StudentSnap) {
  if (!(err instanceof AsaasRequestError)) return;
  if (!err.codes.includes("invalid_customer") || !student.asaasCustomerId) return;
  await db
    .update(students)
    .set({ asaasCustomerId: null, updatedAt: new Date() })
    .where(eq(students.id, student.id));
}

function mapChargeError(err: unknown, log?: FastifyBaseLogger): CheckoutSessionResult {
  if (isUniqueViolation(err)) throw err;
  if (err instanceof AsaasRequestError) {
    logAsaas(log, err);
    return badGateway();
  }
  if (err instanceof CheckoutChargeError) {
    log?.error({ name: err.name }, "Plano sem valor cobrável");
    return badGateway();
  }
  throw err;
}

function logAsaas(log: FastifyBaseLogger | undefined, err: AsaasRequestError) {
  log?.error(
    { status: err.status, correlationId: err.correlationId, codes: err.codes, op: err.op },
    "Falha na API Asaas",
  );
}

function success(
  input: CheckoutSessionData & {
    statusCode: 200 | 201;
    notifyName: string | null;
  },
): CheckoutSessionResult {
  return {
    ok: true,
    statusCode: input.statusCode,
    notifyName: input.notifyName,
    data: {
      studentId: input.studentId,
      paymentId: input.paymentId,
      checkoutUrl: input.checkoutUrl,
      status: input.status,
    },
  };
}

function forbidden(): CheckoutSessionResult {
  return {
    ok: false,
    statusCode: 403,
    error: "Forbidden",
    message: "Equipe cadastra alunos pelo CRM",
  };
}

function notFound(): CheckoutSessionResult {
  return { ok: false, statusCode: 404, error: "NotFound", message: "Plano não encontrado" };
}

function notConfigured(): CheckoutSessionResult {
  return {
    ok: false,
    statusCode: 503,
    error: "AsaasNotConfigured",
    message: "Cobrança Asaas não está configurada",
  };
}

function badGateway(): CheckoutSessionResult {
  return {
    ok: false,
    statusCode: 502,
    error: "BadGateway",
    message: "Não foi possível criar a cobrança",
  };
}

class CheckoutChargeError extends Error {
  constructor() {
    super("valor de plano inválido");
    this.name = "CheckoutChargeError";
  }
}

function requireAsaasId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 80) throw new CheckoutChargeError();
  return trimmed;
}

function asaasValue(amount: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new CheckoutChargeError();
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new CheckoutChargeError();
  return value;
}

/** Telefone fixo (10) ou celular (11), só dígitos. CPF não existe no schema. */
function asaasPhones(raw: string | null): { phone?: string; mobilePhone?: string } {
  const digits = raw?.replace(/\D/g, "") ?? "";
  const local =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  if (local.length === 11) return { mobilePhone: local };
  if (local.length === 10) return { phone: local };
  return {};
}

function httpsUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith("https://") || trimmed.length > 2000) return null;
  return trimmed;
}

function snapStudent(row: typeof students.$inferSelect, fallbackEmail: string): StudentSnap {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    email: row.email?.trim() || fallbackEmail,
    phone: row.phone,
    asaasCustomerId: row.asaasCustomerId?.trim() || null,
  };
}

/** Data civil de Recife — o aluno não deve ver o dia UTC virar às 21h. */
function todayInRecife(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function findUserByEmail(email: string) {
  return db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email}`,
    columns: { id: true, email: true, name: true, role: true, studentId: true },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && (err as { code?: unknown }).code === "23505") return true;
  if ("cause" in err) return isUniqueViolation((err as { cause?: unknown }).cause);
  return false;
}

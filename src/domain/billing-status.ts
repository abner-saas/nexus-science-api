export const APP_BLOCK_AFTER_DAYS = 7;

export type StudentLifecycle = "Ativo" | "Pausado" | "Inadimplente" | "Cancelado" | "Pendente";

export type PaymentSnap = {
  status: "PENDING" | "CONFIRMED" | "OVERDUE" | "REFUNDED" | "CANCELLED";
  dueDate: string;
};

export type BillingDecision = {
  status: StudentLifecycle;
  appAccess: boolean;
  daysOverdue: number;
};

export type BillingReason = "overdue" | "paused" | "cancelled" | "pending" | null;

export type BillingView = {
  status: StudentLifecycle;
  appAccess: boolean;
  blocked: boolean;
  daysOverdue: number;
  reason: BillingReason;
};

const OPEN_PAYMENT = new Set(["PENDING", "OVERDUE"]);

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function todayInRecife(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Recife",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Ativo e inadimplente seguem as cobranças. Pausado e cancelado só mudam
 * quando a equipe grava esse status. O app fecha no 7º dia de atraso.
 */
export function resolveBilling(input: {
  status: StudentLifecycle;
  payments: PaymentSnap[];
  today: string;
}): BillingDecision {
  if (input.status === "Pausado" || input.status === "Cancelado") {
    return { status: input.status, appAccess: false, daysOverdue: 0 };
  }

  const daysLate = input.payments
    .filter((payment) => OPEN_PAYMENT.has(payment.status))
    .map((payment) => daysBetween(payment.dueDate, input.today))
    .filter((days) => days >= 1);
  const daysOverdue = daysLate.length ? Math.max(...daysLate) : 0;
  const paid = input.payments.some((payment) => payment.status === "CONFIRMED");

  if (input.status === "Pendente" && !paid) {
    return { status: "Pendente", appAccess: false, daysOverdue: 0 };
  }

  if (daysOverdue >= APP_BLOCK_AFTER_DAYS) {
    return { status: "Inadimplente", appAccess: false, daysOverdue };
  }
  if (daysOverdue >= 1) {
    return { status: "Inadimplente", appAccess: true, daysOverdue };
  }
  return { status: "Ativo", appAccess: true, daysOverdue: 0 };
}

export function billingView(decision: BillingDecision): BillingView {
  let reason: BillingReason = null;
  if (decision.status === "Pausado") reason = "paused";
  else if (decision.status === "Cancelado") reason = "cancelled";
  else if (decision.status === "Pendente") reason = "pending";
  else if (!decision.appAccess && decision.daysOverdue >= APP_BLOCK_AFTER_DAYS) reason = "overdue";

  return {
    status: decision.status,
    appAccess: decision.appAccess,
    blocked: !decision.appAccess,
    daysOverdue: decision.daysOverdue,
    reason,
  };
}

export function blockMessage(view: BillingView): string {
  switch (view.reason) {
    case "paused":
      return "Sua consultoria está pausada. Fale com a equipe para retomar.";
    case "cancelled":
      return "Sua consultoria foi encerrada. Fale com a equipe se quiser voltar.";
    case "pending":
      return "O plano ainda não foi confirmado. Conclua o pagamento para liberar o app.";
    case "overdue":
      return "O acesso ao treino e ao biofeedback fica bloqueado a partir do 7º dia de atraso. O pagamento libera de novo.";
    default:
      return "O acesso ao app está bloqueado. Fale com a equipe.";
  }
}

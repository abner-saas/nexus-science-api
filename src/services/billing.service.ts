import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { payments, students } from "../db/schema.js";
import {
  type BillingView,
  billingView,
  blockMessage,
  type PaymentSnap,
  resolveBilling,
  type StudentLifecycle,
  todayInRecife,
} from "../domain/billing-status.js";

export async function syncStudentBilling(
  studentId: string,
  now = new Date(),
): Promise<BillingView> {
  const student = await db.query.students.findFirst({
    where: eq(students.id, studentId),
    columns: { status: true, appAccess: true },
  });
  if (!student) {
    return billingView({ status: "Cancelado", appAccess: false, daysOverdue: 0 });
  }

  const rows = await db
    .select({ status: payments.status, dueDate: payments.dueDate })
    .from(payments)
    .where(eq(payments.studentId, studentId));

  const decision = resolveBilling({
    status: student.status,
    payments: rows as PaymentSnap[],
    today: todayInRecife(now),
  });

  if (decision.status !== student.status || decision.appAccess !== student.appAccess) {
    await db
      .update(students)
      .set({ status: decision.status, appAccess: decision.appAccess, updatedAt: new Date() })
      .where(eq(students.id, studentId));
  }

  return billingView(decision);
}

export async function allowStudentContent(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (request.user.role !== "STUDENT" || !request.user.studentId) return true;
  const billing = await syncStudentBilling(request.user.studentId);
  if (billing.appAccess) return true;
  reply.status(403).send({
    error: "Forbidden",
    code: "APP_BLOCKED",
    message: blockMessage(billing),
    billing,
  });
  return false;
}

export function isRecalculatedStatus(status: StudentLifecycle | undefined): boolean {
  return status === "Ativo" || status === "Inadimplente";
}

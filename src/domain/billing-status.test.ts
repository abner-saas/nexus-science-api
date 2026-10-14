import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingView,
  blockMessage,
  type PaymentSnap,
  resolveBilling,
  todayInRecife,
} from "./billing-status.js";

const overdue = (dueDate: string, status: PaymentSnap["status"] = "OVERDUE"): PaymentSnap => ({
  status,
  dueDate,
});

describe("resolveBilling", () => {
  it("keeps a current student active with app access", () => {
    const decision = resolveBilling({
      status: "Ativo",
      today: "2026-10-13",
      payments: [overdue("2026-10-20", "PENDING"), { status: "CONFIRMED", dueDate: "2026-09-13" }],
    });
    assert.deepEqual(decision, { status: "Ativo", appAccess: true, daysOverdue: 0 });
  });

  it("marks inadimplente on the first day late and still allows the app", () => {
    const decision = resolveBilling({
      status: "Ativo",
      today: "2026-10-14",
      payments: [overdue("2026-10-13", "PENDING")],
    });
    assert.equal(decision.status, "Inadimplente");
    assert.equal(decision.appAccess, true);
    assert.equal(decision.daysOverdue, 1);
  });

  it("blocks the app on the 7th day late and keeps it open on the 6th", () => {
    const open = resolveBilling({
      status: "Inadimplente",
      today: "2026-10-07",
      payments: [overdue("2026-10-01")],
    });
    const blocked = resolveBilling({
      status: "Inadimplente",
      today: "2026-10-08",
      payments: [overdue("2026-10-01")],
    });
    assert.equal(open.daysOverdue, 6);
    assert.equal(open.appAccess, true);
    assert.equal(blocked.daysOverdue, 7);
    assert.equal(blocked.appAccess, false);
    assert.equal(billingView(blocked).reason, "overdue");
  });

  it("uses the oldest open charge when several are late", () => {
    const decision = resolveBilling({
      status: "Ativo",
      today: "2026-10-13",
      payments: [overdue("2026-10-10"), overdue("2026-10-01"), overdue("2026-10-20", "PENDING")],
    });
    assert.equal(decision.daysOverdue, 12);
    assert.equal(decision.appAccess, false);
  });

  it("restores access after the late charge is confirmed", () => {
    const decision = resolveBilling({
      status: "Inadimplente",
      today: "2026-10-20",
      payments: [{ status: "CONFIRMED", dueDate: "2026-10-01" }],
    });
    assert.deepEqual(decision, { status: "Ativo", appAccess: true, daysOverdue: 0 });
  });

  it("does not change paused or cancelled students from payments", () => {
    for (const status of ["Pausado", "Cancelado"] as const) {
      const decision = resolveBilling({
        status,
        today: "2026-10-20",
        payments: [{ status: "CONFIRMED", dueDate: "2026-10-01" }, overdue("2026-09-01")],
      });
      assert.equal(decision.status, status);
      assert.equal(decision.appAccess, false);
      assert.equal(decision.daysOverdue, 0);
    }
  });

  it("keeps an unpaid lead pending", () => {
    const decision = resolveBilling({
      status: "Pendente",
      today: "2026-10-20",
      payments: [overdue("2026-10-01", "PENDING")],
    });
    assert.equal(decision.status, "Pendente");
    assert.equal(decision.appAccess, false);
    assert.equal(billingView(decision).reason, "pending");
  });

  it("activates a pending student after the first confirmed payment", () => {
    const decision = resolveBilling({
      status: "Pendente",
      today: "2026-10-13",
      payments: [{ status: "CONFIRMED", dueDate: "2026-10-13" }],
    });
    assert.equal(decision.status, "Ativo");
    assert.equal(decision.appAccess, true);
  });

  it("ignores refunded and cancelled charges", () => {
    const decision = resolveBilling({
      status: "Ativo",
      today: "2026-10-20",
      payments: [
        { status: "REFUNDED", dueDate: "2026-09-01" },
        { status: "CANCELLED", dueDate: "2026-09-01" },
      ],
    });
    assert.equal(decision.status, "Ativo");
  });
});

describe("blockMessage", () => {
  it("explains the 7-day lock", () => {
    const view = billingView({ status: "Inadimplente", appAccess: false, daysOverdue: 7 });
    assert.match(blockMessage(view), /7º dia/);
  });

  it("explains a manual pause", () => {
    const view = billingView({ status: "Pausado", appAccess: false, daysOverdue: 0 });
    assert.match(blockMessage(view), /pausada/);
  });
});

describe("todayInRecife", () => {
  it("uses the Recife calendar date", () => {
    assert.equal(todayInRecife(new Date("2026-10-14T02:30:00Z")), "2026-10-13");
    assert.equal(todayInRecife(new Date("2026-10-14T03:00:00Z")), "2026-10-14");
  });
});

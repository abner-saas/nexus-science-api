import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCurrentRoutine, planRoutineStatusChange, type RoutineSnap } from "./routine-status.js";

const routines: RoutineSnap[] = [
  { id: "live", status: "Em andamento", createdAt: "2026-08-01T00:00:00.000Z" },
  { id: "next", status: "A liberar", createdAt: "2026-09-01T00:00:00.000Z" },
  { id: "later", status: "A liberar", createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "draft", status: "Em digitação", createdAt: "2026-10-02T00:00:00.000Z" },
];

describe("planRoutineStatusChange", () => {
  it("promotes the oldest waiting routine when the current one is concluded", () => {
    const result = planRoutineStatusChange(routines, "live", "Concluída");
    assert.deepEqual(result, {
      updates: [
        { id: "live", status: "Concluída" },
        { id: "next", status: "Em andamento" },
      ],
    });
  });

  it("promotes a legacy Ativa routine the same way", () => {
    const result = planRoutineStatusChange(
      [{ id: "old", status: "Ativa", createdAt: "2026-01-01" }, routines[1]],
      "old",
      "Concluída",
    );
    assert.ok(!("error" in result));
    assert.deepEqual(result.updates[1], { id: "next", status: "Em andamento" });
  });

  it("does not promote when a draft is concluded", () => {
    const result = planRoutineStatusChange(routines, "draft", "Concluída");
    assert.deepEqual(result, { updates: [{ id: "draft", status: "Concluída" }] });
  });

  it("concludes without a successor", () => {
    const result = planRoutineStatusChange([routines[0]], "live", "Concluída");
    assert.deepEqual(result, { updates: [{ id: "live", status: "Concluída" }] });
  });

  it("rejects an unknown routine or status", () => {
    assert.deepEqual(planRoutineStatusChange(routines, "missing", "Concluída"), {
      error: "missing",
    });
    assert.deepEqual(planRoutineStatusChange(routines, "live", "Ativa"), {
      error: "unknown_status",
    });
  });

  it("lets the student app see only the routine in progress", () => {
    assert.equal(isCurrentRoutine("Em andamento"), true);
    assert.equal(isCurrentRoutine("Ativa"), true);
    assert.equal(isCurrentRoutine("A liberar"), false);
    assert.equal(isCurrentRoutine("Em digitação"), false);
    assert.equal(isCurrentRoutine("Concluída"), false);
  });
});

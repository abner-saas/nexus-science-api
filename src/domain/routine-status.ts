export const ROUTINE_STATUSES = ["Em digitação", "A liberar", "Em andamento", "Concluída"] as const;

export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export type RoutineSnap = {
  id: string;
  status: string;
  createdAt: string;
};

const LIVE = new Set(["Em andamento", "Ativa"]);

export function isRoutineStatus(value: string): value is RoutineStatus {
  return (ROUTINE_STATUSES as readonly string[]).includes(value);
}

/** The student app only receives the routine currently in progress. */
export function isCurrentRoutine(status: string): boolean {
  return LIVE.has(status);
}

export function planRoutineStatusChange(
  routines: RoutineSnap[],
  routineId: string,
  nextStatus: string,
): { updates: { id: string; status: RoutineStatus }[] } | { error: "missing" | "unknown_status" } {
  if (!isRoutineStatus(nextStatus)) return { error: "unknown_status" };
  const current = routines.find((routine) => routine.id === routineId);
  if (!current) return { error: "missing" };

  const updates: { id: string; status: RoutineStatus }[] = [{ id: routineId, status: nextStatus }];
  if (nextStatus === "Concluída" && LIVE.has(current.status)) {
    const waiting = routines
      .filter((routine) => routine.id !== routineId && routine.status === "A liberar")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    if (waiting) updates.push({ id: waiting.id, status: "Em andamento" });
  }
  return { updates };
}

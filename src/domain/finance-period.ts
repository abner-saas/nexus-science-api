export const FINANCE_PERIODS = ["this_month", "prev_month", "12m", "ytd", "custom"] as const;

export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

export type DateRange = { from: string; to: string };

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function parts(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, date: date ?? 1 };
}

export function resolveFinancePeriod(
  period: FinancePeriod,
  today: string,
  custom?: { from?: string; to?: string },
): DateRange | { error: "invalid_range" } {
  const { year, month } = parts(today);

  if (period === "this_month") return { from: iso(year, month, 1), to: today };
  if (period === "prev_month") {
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  if (period === "12m") {
    const start = new Date(Date.UTC(year, month - 1 - 11, 1));
    return { from: start.toISOString().slice(0, 10), to: today };
  }
  if (period === "ytd") return { from: iso(year, 1, 1), to: today };

  const from = custom?.from;
  const to = custom?.to;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: "invalid_range" };
  }
  if (from > to) return { error: "invalid_range" };
  return { from, to };
}

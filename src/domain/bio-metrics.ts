const BIO_FIELDS = [
  "energy",
  "mood",
  "stress",
  "sleep",
  "sleepHours",
  "hydration",
  "musclePain",
  "weight",
  "heightCm",
  "calories",
  "hr",
  "steps",
] as const;

export type BioField = (typeof BIO_FIELDS)[number];

export function coerceDecimal(
  value: unknown,
  scale: 1 | 2,
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return { ok: false };
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  return { ok: true, value: amount.toFixed(scale) };
}

/** Fields omitted from the payload stay untouched on the day's upsert. */
export function bioUpdateSet(data: Partial<Record<BioField, unknown>>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of BIO_FIELDS) {
    if (data[key] !== undefined) set[key] = data[key];
  }
  return set;
}

type InsightRow = {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep: number | null;
  musclePain: number | null;
  hydration: string | null;
};

function average(values: number[]): number | null {
  if (!values.length) return null;
  return +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
}

export function buildLocalInsight(name: string, goal: string | null, rows: InsightRow[]): string {
  const energy = average(rows.flatMap((row) => (row.energy == null ? [] : [row.energy])));
  const mood = average(rows.flatMap((row) => (row.mood == null ? [] : [row.mood])));
  const stress = average(rows.flatMap((row) => (row.stress == null ? [] : [row.stress])));
  const sleep = average(rows.flatMap((row) => (row.sleep == null ? [] : [row.sleep])));
  const pain = average(rows.flatMap((row) => (row.musclePain == null ? [] : [row.musclePain])));
  const hydration = average(
    rows.flatMap((row) => {
      const liters = row.hydration == null ? null : Number(row.hydration);
      return liters == null || Number.isNaN(liters) ? [] : [liters];
    }),
  );
  const show = (value: number | null) => (value == null ? "n/d" : String(value));
  const parts = [
    `Insight científico (local) para ${name} — objetivo: ${goal ?? "não informado"}.`,
    `Últimos ${rows.length} dias: energia média ${show(energy)}, humor ${show(mood)}, sono ${show(sleep)}, estresse ${show(stress)}, dor muscular ${show(pain)}, hidratação ${show(hydration)} L.`,
  ];
  if (mood != null && mood <= 4) {
    parts.push("Humor baixo: reduza a cobrança da sessão e priorize sono e contato com a equipe.");
  }
  if (hydration != null && hydration < 2) {
    parts.push("Hidratação abaixo de 2 L: aumente a ingestão de água nos dias de treino.");
  }
  if (stress != null && stress >= 7) {
    parts.push(
      "Estresse elevado: priorize volume moderado e sono consistente (7–9h). Evite recordes pessoais sob alta carga.",
    );
  }
  if (sleep != null && sleep <= 5) {
    parts.push("Qualidade de sono baixa: reduza a intensidade 10–20% até normalizar.");
  }
  if (pain != null && pain >= 7) {
    parts.push("Dor muscular alta: revise carga nos grupos afetados e inclua mobilidade.");
  }
  if (energy != null && energy >= 8 && (stress ?? 5) <= 4) {
    parts.push("Janela favorável de performance: momento adequado para progressão de carga.");
  }
  return parts.join("\n\n");
}

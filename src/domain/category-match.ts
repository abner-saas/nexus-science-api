export type CategoryRule = {
  name: string;
  type: "RECEITA" | "DESPESA";
  matchTerms: string;
};

export const DEFAULT_CATEGORIES: CategoryRule[] = [
  { name: "Mensalidades", type: "RECEITA", matchTerms: "mensalidade, plano, asaas" },
  { name: "Internet", type: "DESPESA", matchTerms: "internet, fibra, claro net, vivo fibra" },
  { name: "Energia", type: "DESPESA", matchTerms: "energia, enel, neoenergia, celpe, light" },
  { name: "Aluguel", type: "DESPESA", matchTerms: "aluguel" },
  { name: "Marketing", type: "DESPESA", matchTerms: "marketing, meta ads, google ads, anuncio" },
  { name: "Ferramentas", type: "DESPESA", matchTerms: "software, ferramenta, assinatura" },
  { name: "Operacional", type: "DESPESA", matchTerms: "operacional" },
];

export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchTerms(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((term) => foldText(term).trim())
    .filter((term) => term.length >= 3);
}

/** Longer terms win, so "internet fibra" beats a generic "net". */
export function matchCategory(
  description: string,
  type: "RECEITA" | "DESPESA",
  categories: CategoryRule[],
): string | null {
  const haystack = foldText(description);
  if (!haystack.trim()) return null;

  let best: { name: string; length: number } | null = null;
  for (const category of categories) {
    if (category.type !== type) continue;
    for (const term of matchTerms(category.matchTerms)) {
      if (!haystack.includes(term)) continue;
      if (!best || term.length > best.length) best = { name: category.name, length: term.length };
    }
  }
  return best?.name ?? null;
}

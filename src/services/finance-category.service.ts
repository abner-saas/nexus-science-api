import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { financeCategories } from "../db/schema.js";
import { type CategoryRule, DEFAULT_CATEGORIES, matchCategory } from "../domain/category-match.js";

export type FinanceCategory = CategoryRule & { id: string };

export async function listCategories(): Promise<FinanceCategory[]> {
  const existing = await db.select().from(financeCategories);
  if (existing.length === 0) {
    await db
      .insert(financeCategories)
      .values(DEFAULT_CATEGORIES.map((category) => ({ ...category })))
      .onConflictDoNothing({ target: [financeCategories.name, financeCategories.type] });
  }
  const rows = existing.length === 0 ? await db.select().from(financeCategories) : existing;
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      matchTerms: row.matchTerms,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function suggestCategory(
  description: string,
  type: "RECEITA" | "DESPESA",
): Promise<string | null> {
  const categories = await listCategories();
  return matchCategory(description, type, categories);
}

export async function createCategory(input: CategoryRule) {
  const [row] = await db
    .insert(financeCategories)
    .values({
      name: input.name.trim(),
      type: input.type,
      matchTerms: input.matchTerms.trim(),
    })
    .returning();
  return row;
}

export async function updateCategory(id: string, input: Partial<CategoryRule>) {
  const [row] = await db
    .update(financeCategories)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.matchTerms !== undefined ? { matchTerms: input.matchTerms.trim() } : {}),
    })
    .where(eq(financeCategories.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCategory(id: string) {
  const [row] = await db
    .delete(financeCategories)
    .where(eq(financeCategories.id, id))
    .returning({ id: financeCategories.id });
  return Boolean(row);
}

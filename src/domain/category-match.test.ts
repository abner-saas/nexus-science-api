import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CategoryRule, DEFAULT_CATEGORIES, matchCategory } from "./category-match.js";

describe("matchCategory", () => {
  it("classifies a bank internet debit as Internet", () => {
    assert.equal(
      matchCategory("PAGAMENTO INTERNET CLARO", "DESPESA", DEFAULT_CATEGORIES),
      "Internet",
    );
  });

  it("does not use an expense rule on income", () => {
    assert.equal(matchCategory("internet", "RECEITA", DEFAULT_CATEGORIES), null);
  });

  it("classifies a tuition credit as Mensalidades", () => {
    assert.equal(
      matchCategory("Mensalidade outubro", "RECEITA", DEFAULT_CATEGORIES),
      "Mensalidades",
    );
  });

  it("prefers the longer matching term", () => {
    const categories: CategoryRule[] = [
      { name: "Genérica", type: "DESPESA", matchTerms: "net" },
      { name: "Internet fibra", type: "DESPESA", matchTerms: "internet fibra" },
    ];
    assert.equal(matchCategory("NET INTERNET FIBRA", "DESPESA", categories), "Internet fibra");
  });

  it("ignores accents and returns null without a description", () => {
    assert.equal(matchCategory("ANÚNCIO META", "DESPESA", DEFAULT_CATEGORIES), "Marketing");
    assert.equal(matchCategory("   ", "DESPESA", DEFAULT_CATEGORIES), null);
  });

  it("ignores terms shorter than 3 characters", () => {
    const categories: CategoryRule[] = [{ name: "Curta", type: "DESPESA", matchTerms: "oi, luz" }];
    assert.equal(matchCategory("conta de oi", "DESPESA", categories), null);
    assert.equal(matchCategory("conta de luz", "DESPESA", categories), "Curta");
  });
});

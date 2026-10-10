import { extractModelNumbers, matchModelNumber } from "./model-number";
import type { MatchSignals, ProductSearchQuery } from "./types";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "for",
  "with",
  "of",
  "by",
]);

export function tokens(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).filter((t) => !STOP_WORDS.has(t));
}

function containsTokens(haystack: Set<string>, phrase: string) {
  const needed = tokens(phrase);
  return needed.length > 0 && needed.every((t) => haystack.has(t));
}

/** Sørensen–Dice overlap of two token sets. */
export function dice(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared++;
  return Math.round(((2 * shared) / (left.size + right.size)) * 1000) / 1000;
}

/**
 * Compare the query with a source's title and text. Every signal is a plain
 * observation; null means the query did not include that field.
 */
export function computeMatchSignals(
  query: ProductSearchQuery,
  title: string,
  text: string,
): MatchSignals {
  const full = `${title}\n${text}`;
  const present = new Set(tokens(full));
  const model = query.modelNumber
    ? matchModelNumber(query.modelNumber, full)
    : null;
  const productTerms = [...new Set(tokens(query.product ?? ""))];
  const queryTokens = tokens(
    [query.brand, query.product, query.modelNumber].filter(Boolean).join(" "),
  );
  return {
    exactModelNumber: model ? model.exact : null,
    normalizedModelNumber: model ? model.normalized : null,
    modelNumberSuffixVariants: model?.suffixVariants ?? [],
    modelNumbersSeen: model?.seen ?? extractModelNumbers(full),
    brandMatch: query.brand ? containsTokens(present, query.brand) : null,
    productTermsMatched: productTerms.filter((t) => present.has(t)),
    productTermsMissing: productTerms.filter((t) => !present.has(t)),
    titleTokenOverlap: dice(queryTokens, tokens(title)),
  };
}

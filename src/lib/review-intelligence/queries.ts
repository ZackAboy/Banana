import {
  reviewQueryInputSchema,
  type ReviewQueryInput,
  type ReviewQueryPlan,
} from "./types";

const clean = (value: string | undefined) =>
  value?.normalize("NFKC").trim().replace(/\s+/g, " ") || undefined;
// Always quoted: unquoted, Google read "CFI-ZCT2W" as "CFI" in a live run
// (see src/lib/search/product-search/README.md history).
const quote = (value: string) => `"${value.replace(/"/g, "")}"`;

export function cleanReviewQuery(input: ReviewQueryInput): ReviewQueryInput {
  const parsed = reviewQueryInputSchema.parse(input);
  return {
    brand: clean(parsed.brand),
    product: clean(parsed.product),
    modelNumber: clean(parsed.modelNumber),
  };
}

/**
 * Bounded query plan, most specific first. Each entry is one provider request.
 * "reddit" is a keyword, not `site:reddit.com`, which returned no Reddit
 * results through SerpApi in a live run.
 */
export function buildReviewQueries(input: ReviewQueryInput): ReviewQueryPlan[] {
  const { brand, product, modelNumber } = cleanReviewQuery(input);
  const plan: ReviewQueryPlan[] = [];
  const name = [brand, product].filter(Boolean).join(" ");
  if (modelNumber) {
    const model = quote(modelNumber);
    plan.push(
      {
        id: "model-review",
        text: `${model} review`,
        intent: "model",
        target: "reviews",
      },
      {
        id: "model-reddit",
        text: `${model} reddit`,
        intent: "model",
        target: "reddit",
      },
    );
  }
  if (product) {
    plan.push(
      {
        id: "product-review",
        text: `${name} review`,
        intent: "product",
        target: "reviews",
      },
      {
        id: "product-reddit",
        text: `${name} reddit`,
        intent: "product",
        target: "reddit",
      },
      {
        id: "long-term",
        text: `${name} long term review`,
        intent: "long_term",
        target: "reviews",
      },
      {
        id: "problems-reddit",
        text: `${name} problems reddit`,
        intent: "problems",
        target: "reddit",
      },
    );
  } else if (modelNumber) {
    plan.push({
      id: "model-problems",
      text: [quote(modelNumber), brand, "problems"].filter(Boolean).join(" "),
      intent: "problems",
      target: "reddit",
    });
  }
  return plan;
}

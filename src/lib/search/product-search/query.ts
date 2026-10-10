import type { BuiltQuery, ProductSearchQuery } from "./types";

const clean = (value: string | undefined) =>
  value?.normalize("NFKC").trim().replace(/\s+/g, " ") || undefined;
const quote = (value: string) => `"${value.replace(/"/g, "")}"`;

export function cleanQuery(query: ProductSearchQuery): ProductSearchQuery {
  return {
    brand: clean(query.brand),
    product: clean(query.product),
    modelNumber: clean(query.modelNumber),
  };
}

/**
 * Product queries in priority order: the quoted model number with brand first,
 * then brand + product name as the fallback. Review queries follow. Any field
 * may be missing; an empty query yields no product queries.
 */
export function buildQueries(input: ProductSearchQuery): BuiltQuery[] {
  const { brand, product, modelNumber } = cleanQuery(input);
  const queries: BuiltQuery[] = [];
  const name = [brand, product].filter(Boolean).join(" ");
  if (modelNumber) {
    queries.push({
      id: "exact-model",
      text: [quote(modelNumber), brand].filter(Boolean).join(" "),
      fields: brand ? ["modelNumber", "brand"] : ["modelNumber"],
      purpose: "product",
    });
  }
  if (product) {
    queries.push({
      id: "brand-product",
      text: name,
      fields: brand ? ["brand", "product"] : ["product"],
      purpose: "product",
    });
  }
  // Reviews are written about the product name, rarely the model number, so
  // the name is the subject when we have one. A model number is only used
  // without a name, and then quoted: unquoted, "CFI-ZCT2W" made Google return
  // pages about "CFI" (flight instructors, finance courses) in a live run.
  const reviewSubject = product
    ? name
    : modelNumber
      ? [quote(modelNumber), brand].filter(Boolean).join(" ")
      : null;
  if (reviewSubject) {
    const fields: BuiltQuery["fields"] = product
      ? brand
        ? ["brand", "product"]
        : ["product"]
      : brand
        ? ["modelNumber", "brand"]
        : ["modelNumber"];
    queries.push(
      {
        id: "reviews",
        text: `${reviewSubject} review`,
        fields,
        purpose: "reviews",
      },
      {
        id: "reviews-reddit",
        text: `${reviewSubject} reddit`,
        fields,
        purpose: "reviews",
      },
    );
  }
  return queries;
}

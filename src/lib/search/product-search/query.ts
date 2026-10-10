import {
  productSearchQuerySchema,
  type BuiltQuery,
  type ProductSearchQuery,
  type SearchIdentifier,
} from "./types";
const clean = (value: string | undefined) =>
  value?.normalize("NFKC").trim().replace(/\s+/g, " ") || undefined;
const quote = (value: string) => `"${value.trim().replace(/"/g, "")}"`;

export function cleanQuery(input: ProductSearchQuery): ProductSearchQuery {
  const query = productSearchQuerySchema.parse(input);
  return {
    ...query,
    brand: clean(query.brand),
    product: clean(query.product),
    variant: clean(query.variant),
  };
}
export function queryIdentifiers(
  query: ProductSearchQuery,
): SearchIdentifier[] {
  const list: SearchIdentifier[] = [...(query.identifiers ?? [])];
  for (const [field, kind] of [
    ["modelNumber", "model_number"],
    ["sku", "sku"],
    ["partNumber", "part_number"],
  ] as const)
    if (query[field]) list.push({ kind, value: query[field] });
  return list.filter(
    (item, index) =>
      list.findIndex(
        (other) =>
          other.kind === item.kind &&
          other.value === item.value &&
          other.caseSensitive === item.caseSensitive,
      ) === index,
  );
}
export function buildQueries(
  input: ProductSearchQuery,
  includeReviews = false,
): BuiltQuery[] {
  const query = cleanQuery(input);
  const { brand, product, variant } = query;
  const identifiers = queryIdentifiers(query);
  const queries: BuiltQuery[] = identifiers.map((identifier, index) => ({
    id:
      identifiers.length === 1 && identifier.kind === "model_number"
        ? "exact-model"
        : `identifier-${index}-${identifier.kind}`,
    text: [quote(identifier.value), brand, variant].filter(Boolean).join(" "),
    fields: [
      "identifiers",
      ...(brand ? ["brand" as const] : []),
      ...(variant ? ["variant" as const] : []),
    ],
    purpose: "product",
  }));
  if (product)
    queries.push({
      id: "brand-product",
      text: [brand, product, variant].filter(Boolean).join(" "),
      fields: [
        ...(brand ? ["brand" as const] : []),
        "product",
        ...(variant ? ["variant" as const] : []),
      ],
      purpose: "product",
    });
  const subject = product
    ? [brand, product, variant].filter(Boolean).join(" ")
    : queries[0]?.text;
  if (includeReviews && subject)
    for (const suffix of ["review", "reddit"])
      queries.push({
        id: suffix === "review" ? "reviews" : "reviews-reddit",
        text: `${subject} ${suffix}`,
        fields: product
          ? ["product", ...(brand ? ["brand" as const] : [])]
          : ["identifiers"],
        purpose: "reviews",
      });
  return queries;
}

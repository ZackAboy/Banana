import { z } from "zod";

// Module-local discovery evidence. No final identity or calibrated confidence.
const text = z.string().min(1);
const optionalText = z
  .string()
  .max(500)
  .refine((v) => v.trim().length > 0)
  .optional();
export const httpUrl = z.url({ protocol: /^https?$/ });
const timestamp = z.iso.datetime();
export const identifierKindSchema = z.enum([
  "model_number",
  "sku",
  "part_number",
]);
export const searchIdentifierSchema = z
  .object({
    kind: identifierKindSchema,
    value: z
      .string()
      .min(1)
      .max(120)
      .refine((v) => v.trim().length > 0),
    caseSensitive: z.boolean().optional(),
  })
  .strict();
export const productSearchQuerySchema = z
  .object({
    brand: optionalText,
    product: optionalText,
    // Existing shorthand remains supported; identifiers is the typed boundary.
    modelNumber: searchIdentifierSchema.shape.value.optional(),
    sku: searchIdentifierSchema.shape.value.optional(),
    partNumber: searchIdentifierSchema.shape.value.optional(),
    variant: optionalText,
    identifiers: z.array(searchIdentifierSchema).max(8).optional(),
  })
  .strict()
  .refine(
    (q) =>
      (q.identifiers?.length ?? 0) +
        Number(Boolean(q.modelNumber)) +
        Number(Boolean(q.sku)) +
        Number(Boolean(q.partNumber)) <=
      8,
    "Supply at most eight identifier clues.",
  );
export const providerKindSchema = z.enum([
  "web",
  "shopping",
  "visual",
  "reviews",
]);
export const errorCodeSchema = z.enum([
  "SKIPPED",
  "NOT_CONFIGURED",
  "AUTH",
  "TIMEOUT",
  "RATE_LIMITED",
  "HTTP_ERROR",
  "INVALID_RESPONSE",
  "PROVIDER_ERROR",
]);
export const safeErrorSchema = z.object({
  code: errorCodeSchema,
  message: text,
});
export const requestRecordSchema = z.object({
  id: text,
  queryId: text,
  engine: text,
  queryText: z.string().nullable(),
  // Query parameters/userinfo removed; hash correlates the actual input URL.
  inputImageUrl: httpUrl.nullable(),
  inputImageId: z.string().nullable(),
  country: text,
  language: text,
  executed: z.boolean(),
  status: z.enum(["pending", "ok", "error"]),
  error: safeErrorSchema.nullable(),
  retrievedAt: timestamp,
  discardedRows: z.number().int().nonnegative(),
});
export const providerRefSchema = z.object({
  provider: text,
  kind: providerKindSchema,
  engine: z.string().nullable(),
  queryId: text,
  requestId: z.string().nullable(),
  retrievedAt: timestamp,
  sourceImageIndex: z.number().int().positive().optional(),
});
export const identifierObservationSchema = z.object({
  kind: identifierKindSchema,
  queryValue: text,
  normalizedQueryValue: text,
  caseSensitive: z.boolean(),
  observedValue: text,
  normalizedObservedValue: text,
  match: z.enum(["literal", "normalized", "extension"]),
  field: text,
});
export const matchSignalsSchema = z.object({
  exactModelNumber: z.boolean().nullable(),
  normalizedModelNumber: z.boolean().nullable(),
  modelNumberSuffixVariants: z.array(z.string()),
  // Legacy field: untyped identifier-shaped tokens, not extracted model facts.
  modelNumbersSeen: z.array(z.string()),
  brandMatch: z.boolean().nullable(),
  productTermsMatched: z.array(z.string()),
  productTermsMissing: z.array(z.string()),
  titleTokenOverlap: z.number().min(0).max(1),
});
export const sourceObservationSchema = z.object({
  ...providerRefSchema.shape,
  field: text,
  title: text,
  url: httpUrl,
  domain: text,
  position: z.number().int().positive().nullable(),
  snippet: z.string().nullable(),
  imageUrls: z.array(httpUrl),
  providerProductId: z.string().nullable(),
  urlType: z.enum([
    "source_page",
    "google_product_page",
    "merchant_page",
    "unknown",
  ]),
  brandClue: z.string().nullable(),
  variantClue: z.string().nullable(),
  identifiers: z.array(identifierObservationSchema),
});
export const evidenceSchema = z.object({
  claim: text,
  sourceUrl: httpUrl,
  provider: text,
  queryId: text,
  requestId: z.string().nullable(),
  field: text,
  snippet: z.string(),
  retrievedAt: timestamp,
});
export const externalProductCandidateSchema = z.object({
  id: text,
  title: text,
  brand: z.string().nullable(),
  variant: z.string().nullable(),
  domain: text,
  imageUrls: z.array(httpUrl),
  identifierObservations: z.array(identifierObservationSchema),
  modelNumbersSeen: z.array(z.string()),
  canonicalUrl: httpUrl,
  urls: z.array(httpUrl),
  foundBy: z.array(providerRefSchema).min(1),
  observations: z.array(sourceObservationSchema).min(1),
  matchSignals: matchSignalsSchema,
  evidence: z.array(evidenceSchema),
});
export const offerConditionSchema = z.enum([
  "new",
  "used",
  "refurbished",
  "open_box",
  "unknown",
]);
export const offerObservationSchema = sourceObservationSchema.extend({
  merchant: text,
  displayedPrice: z.string().nullable(),
  currencyHint: z.string().nullable(),
  displayedListPrice: z.string().nullable(),
  conditionText: z.string().nullable(),
  availability: z.string().nullable(),
  shipping: z.string().nullable(),
});
export const externalOfferSchema = z.object({
  merchant: text,
  title: text,
  priceMinor: z.number().int().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  originalPrice: z.string().nullable(),
  listPriceMinor: z.number().int().nonnegative().nullable(),
  availability: z.string().nullable(),
  condition: offerConditionSchema,
  shipping: z.string().nullable(),
  url: httpUrl,
  canonicalUrl: httpUrl,
  foundBy: z.array(providerRefSchema).min(1),
  observations: z.array(offerObservationSchema).min(1),
  matchSignals: matchSignalsSchema,
});
export const reviewSourceTypeSchema = z.enum([
  "reddit",
  "review_site",
  "manufacturer_spec",
  "other",
]);
export const discoveredReviewSourceSchema = z.object({
  title: text,
  url: httpUrl,
  canonicalUrl: httpUrl,
  sourceType: reviewSourceTypeSchema,
  domain: text,
  snippet: z.string().nullable(),
  publishedAt: z.string().nullable(),
  foundBy: z.array(providerRefSchema).min(1),
  observations: z.array(sourceObservationSchema).min(1),
});
export const providerRunSchema = z.object({
  provider: text,
  kind: providerKindSchema,
  status: z.enum(["ok", "partial", "error", "skipped"]),
  queryIds: z.array(z.string()),
  requests: z.array(requestRecordSchema),
  discardedRows: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  error: safeErrorSchema.nullable(),
  sourceImageIndex: z.number().int().positive().optional(),
});
export const builtQuerySchema = z.object({
  id: text,
  text,
  fields: z.array(
    z.enum([
      "brand",
      "product",
      "modelNumber",
      "sku",
      "partNumber",
      "variant",
      "identifiers",
    ]),
  ),
  purpose: z.enum(["product", "reviews"]),
});
export const productSearchResultSchema = z.object({
  query: productSearchQuerySchema,
  queries: z.array(builtQuerySchema),
  candidates: z.array(externalProductCandidateSchema),
  offers: z.array(externalOfferSchema),
  reviewSources: z.array(discoveredReviewSourceSchema),
  providerRuns: z.array(providerRunSchema),
  startedAt: timestamp,
  finishedAt: timestamp,
  raw: z.record(z.string(), z.array(z.unknown())).optional(),
});
export type SearchIdentifier = z.infer<typeof searchIdentifierSchema>;
export type IdentifierObservation = z.infer<typeof identifierObservationSchema>;
export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export type OfferObservation = z.infer<typeof offerObservationSchema>;
export type RequestRecord = z.infer<typeof requestRecordSchema>;
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ProviderRef = z.infer<typeof providerRefSchema>;
export type MatchSignals = z.infer<typeof matchSignalsSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ExternalProductCandidate = z.infer<
  typeof externalProductCandidateSchema
>;
export type OfferCondition = z.infer<typeof offerConditionSchema>;
export type ExternalOffer = z.infer<typeof externalOfferSchema>;
export type ReviewSourceType = z.infer<typeof reviewSourceTypeSchema>;
export type DiscoveredReviewSource = z.infer<
  typeof discoveredReviewSourceSchema
>;
export type ProviderRun = z.infer<typeof providerRunSchema>;
export type BuiltQuery = z.infer<typeof builtQuerySchema>;
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;

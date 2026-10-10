import { z } from "zod";

// Module-local contracts for external product search. These deliberately live
// outside src/schemas: fusion and the shared ProductCandidate/ProductOffer types
// must agree on them before any of this is promoted to a shared contract.
// None of these types carry a verdict (confirmed/likely/uncertain) or confidence.

const optionalText = z.string().trim().min(1).optional();
const isoTimestamp = z.iso.datetime();
const httpUrl = z.url({ protocol: /^https?$/ });

export const productSearchQuerySchema = z.object({
  brand: optionalText,
  product: optionalText,
  modelNumber: optionalText,
});

export const providerKindSchema = z.enum([
  "web",
  "shopping",
  "visual",
  "reviews",
]);

/** Which concrete provider produced an item, and through which query. */
export const providerRefSchema = z.object({
  provider: z.string().min(1),
  kind: providerKindSchema,
  queryId: z.string().min(1),
  retrievedAt: isoTimestamp,
});

/** Raw, uninterpreted comparisons between the query and a source's text. */
export const matchSignalsSchema = z.object({
  /** Query model number appears verbatim (case-insensitive, whole token). */
  exactModelNumber: z.boolean().nullable(),
  /** Matches after removing case, spaces, hyphens, dots and underscores. */
  normalizedModelNumber: z.boolean().nullable(),
  /** Seen tokens that extend the query model with a short suffix (e.g. regional). */
  modelNumberSuffixVariants: z.array(z.string()),
  /** Model-number-like tokens seen in the source, as originally written. */
  modelNumbersSeen: z.array(z.string()),
  brandMatch: z.boolean().nullable(),
  productTermsMatched: z.array(z.string()),
  productTermsMissing: z.array(z.string()),
  /** Dice overlap of query tokens and title tokens, 0..1. Not a probability. */
  titleTokenOverlap: z.number().min(0).max(1),
});

export const evidenceSchema = z.object({
  claim: z.string().min(1),
  sourceUrl: httpUrl,
  provider: z.string().min(1),
  queryId: z.string().min(1),
  /** Which field of the provider response the snippet came from. */
  field: z.string().min(1),
  snippet: z.string(),
  retrievedAt: isoTimestamp,
});

export const externalProductCandidateSchema = z.object({
  title: z.string().min(1),
  /** Only when a provider states it explicitly; never inferred. */
  brand: z.string().nullable(),
  modelNumbersSeen: z.array(z.string()),
  canonicalUrl: httpUrl,
  /** Every original URL merged into this candidate. */
  urls: z.array(httpUrl),
  foundBy: z.array(providerRefSchema).min(1),
  matchSignals: matchSignalsSchema,
  evidence: z.array(evidenceSchema),
});

export const offerConditionSchema = z.enum([
  "new",
  "used",
  "refurbished",
  "unknown",
]);

export const externalOfferSchema = z.object({
  merchant: z.string().min(1),
  title: z.string().min(1),
  /** Integer minor units (cents for USD, yen for JPY). Null if unparseable. */
  priceMinor: z.number().int().nonnegative().nullable(),
  /** ISO 4217. Null when the price string does not establish a currency. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  originalPrice: z.string().nullable(),
  /** Listed pre-discount price, when the provider gives one. */
  listPriceMinor: z.number().int().nonnegative().nullable(),
  availability: z.string().nullable(),
  condition: offerConditionSchema,
  shipping: z.string().nullable(),
  url: httpUrl,
  canonicalUrl: httpUrl,
  foundBy: z.array(providerRefSchema).min(1),
  matchSignals: matchSignalsSchema,
});

export const reviewSourceTypeSchema = z.enum([
  "reddit",
  "review_site",
  "manufacturer_spec",
  "other",
]);

export const discoveredReviewSourceSchema = z.object({
  title: z.string().min(1),
  url: httpUrl,
  canonicalUrl: httpUrl,
  sourceType: reviewSourceTypeSchema,
  domain: z.string().min(1),
  snippet: z.string().nullable(),
  publishedAt: z.string().nullable(),
  foundBy: z.array(providerRefSchema).min(1),
});

export const providerRunSchema = z.object({
  provider: z.string().min(1),
  kind: providerKindSchema,
  status: z.enum(["ok", "error", "skipped"]),
  queryIds: z.array(z.string()),
  durationMs: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  /** Present when status is error or skipped. */
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .nullable(),
});

export const builtQuerySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  fields: z.array(z.enum(["brand", "product", "modelNumber"])),
  purpose: z.enum(["product", "reviews"]),
});

export const productSearchResultSchema = z.object({
  query: productSearchQuerySchema,
  queries: z.array(builtQuerySchema),
  candidates: z.array(externalProductCandidateSchema),
  offers: z.array(externalOfferSchema),
  reviewSources: z.array(discoveredReviewSourceSchema),
  providerRuns: z.array(providerRunSchema),
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp,
  /** Raw provider payloads, only when explicitly requested for debugging. */
  raw: z.record(z.string(), z.array(z.unknown())).optional(),
});

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

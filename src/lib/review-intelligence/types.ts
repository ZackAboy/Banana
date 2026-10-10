import { z } from "zod";
import {
  identifierObservationSchema,
  requestRecordSchema,
  safeErrorSchema,
} from "@/lib/search/product-search";

// Module-local review evidence contracts. Nothing here is a verdict, rating
// or confidence: relevance is an ordered label backed by recorded observations.

const text = z.string().min(1);
const optionalText = z
  .string()
  .max(200)
  .refine((v) => v.trim().length > 0)
  .optional();
const httpUrl = z.url({ protocol: /^https?$/ });
const timestamp = z.iso.datetime();

export const reviewQueryInputSchema = z
  .object({
    brand: optionalText,
    product: optionalText,
    modelNumber: optionalText,
  })
  .strict();

export const reviewSourceTypeSchema = z.enum([
  "reddit",
  "professional_review",
  "community",
  "retailer_review",
  // Product/specification evidence from the brand itself, never an independent review.
  "manufacturer",
  "other",
]);

/** How the source type was decided, so consumers can discount heuristics. */
export const classificationBasisSchema = z.enum([
  "reddit_domain",
  "manufacturer_domain",
  "known_review_site",
  "review_path",
  "community_pattern",
  "retailer_review_path",
  "retailer_listing",
  "none",
]);

/** Ordered from strongest to weakest. Not a probability. */
export const relevanceLevelSchema = z.enum([
  "exact_model",
  "product_name",
  "product_family",
  "weak",
]);

export const relevanceSchema = z.object({
  level: relevanceLevelSchema,
  /** Query model-number observations in title/snippet (literal, normalized, extension). */
  modelObservations: z.array(identifierObservationSchema),
  /** Identifier-shaped tokens that are not the query model, e.g. "CFI-ZCT1W". */
  otherModelNumbers: z.array(z.string()),
  /** Subset of otherModelNumbers from the same model line ("CFI-ZCT1W"). */
  siblingModelNumbers: z.array(z.string()),
  brandMatch: z.boolean().nullable(),
  productTermsMatched: z.array(z.string()),
  productTermsMissing: z.array(z.string()),
  /** Distinctive product words (e.g. "dualsense") found in title/snippet. */
  familyTermsMatched: z.array(z.string()),
  /** Sibling-product words right after a family word in the title, e.g. "edge". */
  variantConflicts: z.array(z.string()),
  /** Accessory words in the title, e.g. "case", "charging station". */
  accessoryCues: z.array(z.string()),
  /** Why the level is not higher. Empty for exact_model without caveats. */
  notes: z.array(z.string()),
});

export const discoverySchema = z.object({
  provider: text,
  engine: z.string().nullable(),
  queryId: text,
  queryText: z.string().nullable(),
  requestId: z.string().nullable(),
  position: z.number().int().positive().nullable(),
  /** Original URL as returned for this discovery. */
  url: httpUrl,
  retrievedAt: timestamp,
});

export const reviewSourceSchema = z.object({
  /** Stable: derived from the deduplication key, not from discovery order. */
  id: text,
  sourceType: reviewSourceTypeSchema,
  classificationBasis: classificationBasisSchema,
  title: text,
  url: httpUrl,
  domain: text,
  snippet: z.string().nullable(),
  /** Date text exactly as the provider showed it ("Nov 6, 2020", "3 months ago"). */
  publishedText: z.string().nullable(),
  /** YYYY-MM-DD only when publishedText is an absolute date. Never estimated. */
  publishedDate: z.iso.date().nullable(),
  reddit: z
    .object({
      subreddit: z.string().nullable(),
      threadId: z.string().nullable(),
    })
    .nullable(),
  relevance: relevanceSchema,
  discoveredBy: z.array(discoverySchema).min(1),
});

export const reviewQueryPlanSchema = z.object({
  id: text,
  text,
  intent: z.enum(["model", "product", "long_term", "problems"]),
  target: z.enum(["reviews", "reddit"]),
});

export const reviewDiscoveryResultSchema = z.object({
  query: reviewQueryInputSchema,
  queries: z.array(reviewQueryPlanSchema),
  /** Sources at product_family or above, strongest first. */
  sources: z.array(reviewSourceSchema),
  /** Weak or non-review results, kept with reasons instead of silently dropped. */
  excluded: z.array(
    reviewSourceSchema.extend({ exclusionReasons: z.array(text).min(1) }),
  ),
  providerRun: z.object({
    provider: z.string().nullable(),
    status: z.enum(["ok", "partial", "error", "skipped"]),
    requests: z.array(requestRecordSchema),
    discardedRows: z.number().int().nonnegative(),
    error: safeErrorSchema.nullable(),
  }),
  startedAt: timestamp,
  finishedAt: timestamp,
  /** Sanitized provider payloads, only with the includeRaw option (debug/recording). */
  raw: z.array(z.unknown()).optional(),
});

export type ReviewQueryInput = z.infer<typeof reviewQueryInputSchema>;
export type ReviewSourceType = z.infer<typeof reviewSourceTypeSchema>;
export type ClassificationBasis = z.infer<typeof classificationBasisSchema>;
export type RelevanceLevel = z.infer<typeof relevanceLevelSchema>;
export type Relevance = z.infer<typeof relevanceSchema>;
export type Discovery = z.infer<typeof discoverySchema>;
export type ReviewSource = z.infer<typeof reviewSourceSchema>;
export type ReviewQueryPlan = z.infer<typeof reviewQueryPlanSchema>;
export type ReviewDiscoveryResult = z.infer<typeof reviewDiscoveryResultSchema>;

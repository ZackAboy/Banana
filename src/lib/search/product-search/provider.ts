import { z } from "zod";
import type { ImageInput } from "@/lib/providers/interfaces";
import { isEvidenceUrl } from "./url";
import {
  httpUrl,
  requestRecordSchema,
  type BuiltQuery,
  type ProductSearchQuery,
  type ProviderKind,
  type RequestRecord,
} from "./types";

const nullableText = z.string().nullable().default(null);
const hitBase = {
  queryId: z.string().min(1),
  field: z.string().min(1),
  title: z.string().trim().min(1),
  url: httpUrl.refine(isEvidenceUrl),
  requestId: nullableText,
  position: z.number().int().positive().nullable().default(null),
  imageUrls: z.array(httpUrl.refine(isEvidenceUrl)).default([]),
  providerProductId: nullableText,
  urlType: z
    .enum(["source_page", "google_product_page", "merchant_page", "unknown"])
    .default("unknown"),
  brand: nullableText,
  variant: nullableText,
  snippet: nullableText,
};
export const pageHitSchema = z.object(hitBase);
export const offerHitSchema = z.object({
  ...hitBase,
  merchant: z.string().trim().min(1),
  price: nullableText,
  currencyHint: nullableText,
  listPrice: nullableText,
  availability: nullableText,
  condition: nullableText,
  shipping: nullableText,
});
export const reviewHitSchema = z.object({
  ...hitBase,
  publishedAt: nullableText,
});
// Input types permit omitted optional metadata for existing injected providers.
export type PageHit = z.input<typeof pageHitSchema>;
export type OfferHit = z.input<typeof offerHitSchema>;
export type ReviewHit = z.input<typeof reviewHitSchema>;
export interface ProviderOutput {
  pages: PageHit[];
  offers: OfferHit[];
  reviews: ReviewHit[];
  raw: unknown[];
  requests?: RequestRecord[];
  discardedRows?: number;
}
export interface ProviderInput {
  query: ProductSearchQuery;
  queries: BuiltQuery[];
  imageUrl: string | null;
  image?: ImageInput;
  signal: AbortSignal;
  /** Validated snapshots preserve completed requests if a later request times out. */
  onProgress?: (output: ProviderOutput) => void;
}
export interface SearchProvider {
  id: string;
  kind: ProviderKind;
  timeoutMs?: number;
  search(input: ProviderInput): Promise<ProviderOutput>;
}
export const emptyOutput = (): ProviderOutput => ({
  pages: [],
  offers: [],
  reviews: [],
  raw: [],
  requests: [],
  discardedRows: 0,
});
export type ProviderErrorCode = z.infer<
  typeof import("./types").errorCodeSchema
>;
const MESSAGES: Record<ProviderErrorCode, string> = {
  SKIPPED: "Provider skipped for this input.",
  NOT_CONFIGURED: "Provider credentials are not configured.",
  AUTH: "Provider authentication or access failed.",
  TIMEOUT: "Provider request exceeded its time budget.",
  RATE_LIMITED: "Provider request allowance is exhausted.",
  HTTP_ERROR: "Provider transport request failed.",
  INVALID_RESPONSE: "Provider returned an invalid response.",
  PROVIDER_ERROR: "Provider could not complete the request.",
};
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    _privateMessage?: string,
  ) {
    super(MESSAGES[code]);
    void _privateMessage; // Legacy argument is intentionally never exposed.
    this.name = "ProviderError";
  }
}
export const safeProviderError = (error: unknown) => {
  const code =
    error instanceof ProviderError && Object.hasOwn(MESSAGES, error.code)
      ? error.code
      : "PROVIDER_ERROR";
  return { code, message: MESSAGES[code] };
};
export const skip = (_message?: string) => {
  void _message;
  return new ProviderError("SKIPPED");
};

const envelope = z.object({
  pages: z.array(z.unknown()),
  offers: z.array(z.unknown()),
  reviews: z.array(z.unknown()),
  raw: z.array(z.unknown()),
  requests: z.array(requestRecordSchema).default([]),
  discardedRows: z.number().int().nonnegative().default(0),
});
export function validateProviderOutput(value: unknown) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE");
  let discardedRows = parsed.data.discardedRows;
  const rows = <T>(values: unknown[], schema: z.ZodType<T>) =>
    values.flatMap((row) => {
      const result = schema.safeParse(row);
      if (!result.success) {
        discardedRows++;
        return [];
      }
      return [result.data];
    });
  const pages = rows(parsed.data.pages, pageHitSchema);
  const offers = rows(parsed.data.offers, offerHitSchema);
  const reviews = rows(parsed.data.reviews, reviewHitSchema);
  return { ...parsed.data, pages, offers, reviews, discardedRows };
}
export type ValidatedProviderOutput = ReturnType<typeof validateProviderOutput>;

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const calls: number[] = [];
  return function acquire(now = Date.now()) {
    while (calls.length && now - calls[0] >= windowMs) calls.shift();
    if (calls.length >= maxRequests) throw new ProviderError("RATE_LIMITED");
    calls.push(now);
  };
}

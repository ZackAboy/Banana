import type { BuiltQuery, ProductSearchQuery, ProviderKind } from "./types";

// Provider boundary. Concrete sources (SerpApi, a recorded fixture, a future
// vendor) return lightly normalised hits plus their raw payloads. Matching,
// price parsing, classification and deduplication happen once, in search.ts,
// so they behave the same whichever provider ran.

interface HitBase {
  /** Which BuiltQuery produced this hit. */
  queryId: string;
  /** Response field the hit was read from, e.g. "organic_results". */
  field: string;
  title: string;
  url: string;
}

export interface PageHit extends HitBase {
  snippet: string | null;
  /** Only when the provider states it as structured data. */
  brand: string | null;
}

export interface OfferHit extends HitBase {
  merchant: string;
  /** Price exactly as displayed, e.g. "59,99 €". */
  price: string | null;
  /** ISO 4217 market currency used only to resolve ambiguous symbols like "$". */
  currencyHint: string | null;
  listPrice: string | null;
  availability: string | null;
  /** Provider's own condition wording, mapped later. */
  condition: string | null;
  shipping: string | null;
}

export interface ReviewHit extends HitBase {
  snippet: string | null;
  publishedAt: string | null;
}

export interface ProviderOutput {
  pages: PageHit[];
  offers: OfferHit[];
  reviews: ReviewHit[];
  /** Raw responses, one per request made, for debugging. */
  raw: unknown[];
}

export interface ProviderInput {
  query: ProductSearchQuery;
  /** Queries relevant to this provider's kind, in priority order. */
  queries: BuiltQuery[];
  /** Publicly reachable image URL for visual providers, when one exists. */
  imageUrl: string | null;
  signal: AbortSignal;
}

export interface SearchProvider {
  /** Stable identifier recorded on every item, e.g. "serpapi:google". */
  id: string;
  kind: ProviderKind;
  search(input: ProviderInput): Promise<ProviderOutput>;
}

export const emptyOutput = (): ProviderOutput => ({
  pages: [],
  offers: [],
  reviews: [],
  raw: [],
});

export type ProviderErrorCode =
  | "SKIPPED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "NOT_CONFIGURED"
  | "PROVIDER_ERROR";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Not a failure: the provider cannot run for this input (e.g. no image URL). */
export const skip = (message: string) => new ProviderError("SKIPPED", message);

/**
 * Sliding-window limiter shared by every call a provider makes. When the window
 * is full the call is rejected with RATE_LIMITED rather than queued, so one busy
 * provider never stalls the whole search.
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const calls: number[] = [];
  return function acquire(now = Date.now()) {
    while (calls.length && now - calls[0] >= windowMs) calls.shift();
    if (calls.length >= maxRequests)
      throw new ProviderError(
        "RATE_LIMITED",
        `Local limit of ${maxRequests} requests per ${Math.round(windowMs / 1000)} s reached.`,
      );
    calls.push(now);
  };
}

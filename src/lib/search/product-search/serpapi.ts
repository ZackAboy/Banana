import "server-only";
import {
  ProviderError,
  createRateLimiter,
  emptyOutput,
  skip,
  type OfferHit,
  type PageHit,
  type ProviderOutput,
  type ReviewHit,
  type SearchProvider,
} from "./provider";
import type { BuiltQuery } from "./types";

// SerpApi adapters (https://serpapi.com). One key covers Google web search,
// Google Shopping and Google Lens. Only successful searches are billed; the free
// plan allows 250/month at 50/hour, so a local limiter defaults to 50/hour.

export interface SerpApiOptions {
  apiKey: string | undefined;
  /** Google country (gl) and language (hl). They also fix the currency hint. */
  country?: string;
  language?: string;
  /** Requests allowed per hour across all SerpApi providers created together. */
  maxRequestsPerHour?: number;
  /** Product queries tried in order; later ones run only below this many hits. */
  minResultsBeforeFallback?: number;
  /** Injected in tests so they never touch the network. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const COUNTRY_CURRENCY: Record<string, string> = {
  us: "USD",
  ca: "CAD",
  au: "AUD",
  nz: "NZD",
  uk: "GBP",
  gb: "GBP",
  ie: "EUR",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
  it: "EUR",
  nl: "EUR",
  at: "EUR",
  be: "EUR",
  jp: "JPY",
  in: "INR",
  se: "SEK",
  no: "NOK",
  dk: "DKK",
  mx: "MXN",
  br: "BRL",
};

type Json = Record<string, unknown>;
const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): Json[] =>
  Array.isArray(v)
    ? v.filter((x): x is Json => !!x && typeof x === "object")
    : [];
// SerpApi reports "no results" as an error string on an otherwise successful search.
const NO_RESULTS = /hasn't returned any results|no results/i;

export function createSerpApiProviders(
  options: SerpApiOptions,
): SearchProvider[] {
  const country = (options.country ?? "us").toLowerCase();
  const language = options.language ?? "en";
  const currencyHint = COUNTRY_CURRENCY[country] ?? null;
  const minResults = options.minResultsBeforeFallback ?? 3;
  const acquire = createRateLimiter(
    options.maxRequestsPerHour ?? 50,
    3_600_000,
  );
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://serpapi.com/search.json";

  async function call(params: Record<string, string>, signal: AbortSignal) {
    if (!options.apiKey)
      throw new ProviderError("NOT_CONFIGURED", "SERPAPI_API_KEY is not set.");
    acquire();
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries({
      ...params,
      gl: country,
      hl: language,
    }))
      url.searchParams.set(k, v);
    url.searchParams.set("api_key", options.apiKey);
    let response: Response;
    try {
      response = await doFetch(url, { signal });
    } catch (error) {
      if (signal.aborted)
        throw new ProviderError("TIMEOUT", "Request aborted.");
      throw new ProviderError(
        "HTTP_ERROR",
        `Network error contacting SerpApi (${(error as Error).name}).`,
      );
    }
    let body: Json;
    try {
      body = (await response.json()) as Json;
    } catch {
      throw new ProviderError(
        "INVALID_RESPONSE",
        `SerpApi returned non-JSON (HTTP ${response.status}).`,
      );
    }
    const message = str(body.error);
    if (response.status === 401 || response.status === 403)
      throw new ProviderError("AUTH", "SerpApi rejected the API key.");
    if (response.status === 429)
      throw new ProviderError(
        "RATE_LIMITED",
        "SerpApi plan or hourly limit reached.",
      );
    if (!response.ok)
      throw new ProviderError(
        "HTTP_ERROR",
        `SerpApi HTTP ${response.status}${message ? `: ${message}` : ""}.`,
      );
    if (message && !NO_RESULTS.test(message))
      throw new ProviderError("PROVIDER_ERROR", `SerpApi: ${message}`);
    return body;
  }

  /** Run queries in priority order; stop once enough hits were found. */
  async function cascade<T>(
    queries: BuiltQuery[],
    signal: AbortSignal,
    request: (q: BuiltQuery) => Record<string, string>,
    read: (body: Json, q: BuiltQuery) => T[],
  ) {
    const raw: unknown[] = [];
    const hits: T[] = [];
    for (const q of queries) {
      if (hits.length >= minResults) break;
      const body = await call(request(q), signal);
      raw.push(body);
      hits.push(...read(body, q));
    }
    return { raw, hits };
  }

  const organic = (body: Json, q: BuiltQuery): PageHit[] =>
    list(body.organic_results).flatMap((r) => {
      const title = str(r.title);
      const url = str(r.link);
      return title && url
        ? [
            {
              queryId: q.id,
              field: "organic_results",
              title,
              url,
              snippet: str(r.snippet),
              brand: null,
            },
          ]
        : [];
    });

  const web: SearchProvider = {
    id: "serpapi:google",
    kind: "web",
    async search({ queries, signal }) {
      const { raw, hits } = await cascade(
        queries,
        signal,
        (q) => ({ engine: "google", q: q.text, num: "10" }),
        organic,
      );
      return { ...emptyOutput(), pages: hits, raw };
    },
  };

  const shopping: SearchProvider = {
    id: "serpapi:google_shopping",
    kind: "shopping",
    async search({ queries, signal }) {
      const { raw, hits } = await cascade(
        queries,
        signal,
        (q) => ({ engine: "google_shopping", q: q.text }),
        (body, q): OfferHit[] =>
          list(body.shopping_results).flatMap((r) => {
            const title = str(r.title);
            const merchant = str(r.source);
            // Direct merchant link when present, otherwise the Google product page.
            const url = str(r.link) ?? str(r.product_link);
            if (!title || !merchant || !url) return [];
            return [
              {
                queryId: q.id,
                field: "shopping_results",
                title,
                url,
                merchant,
                price: str(r.price),
                currencyHint,
                listPrice: str(r.old_price),
                availability: str(r.stock_information) ?? str(r.tag),
                condition: str(r.second_hand_condition) ?? str(r.condition),
                shipping: str(r.delivery),
              },
            ];
          }),
      );
      return { ...emptyOutput(), offers: hits, raw };
    },
  };

  const lens: SearchProvider = {
    id: "serpapi:google_lens",
    kind: "visual",
    async search({ imageUrl, signal }) {
      // TODO(ProductSearch): needs the agreed temporary image transport (ARCHITECTURE.md).
      if (!imageUrl) throw skip("No public image URL; Lens needs one.");
      const body = await call({ engine: "google_lens", url: imageUrl }, signal);
      const output: ProviderOutput = { ...emptyOutput(), raw: [body] };
      for (const field of ["exact_matches", "visual_matches"]) {
        for (const r of list(body[field])) {
          const title = str(r.title);
          const url = str(r.link);
          if (!title || !url) continue;
          output.pages.push({
            queryId: "lens-image",
            field,
            title,
            url,
            snippet: str(r.source),
            brand: null,
          });
          const price =
            r.price && typeof r.price === "object" ? (r.price as Json) : null;
          const merchant = str(r.source);
          if (price && merchant)
            output.offers.push({
              queryId: "lens-image",
              field,
              title,
              url,
              merchant,
              price: str(price.value),
              // Lens may report a symbol such as "$"; only an ISO code overrides the market.
              currencyHint: /^[A-Z]{3}$/.test(str(price.currency) ?? "")
                ? str(price.currency)
                : currencyHint,
              listPrice: null,
              availability: str(r.in_stock) ?? str(r.stock_information),
              condition: str(r.condition),
              shipping: null,
            });
        }
      }
      return output;
    },
  };

  const reviews: SearchProvider = {
    id: "serpapi:google_reviews",
    kind: "reviews",
    async search({ queries, signal }) {
      const raw: unknown[] = [];
      const hits: ReviewHit[] = [];
      // Each review query targets a different source type, so all of them run.
      for (const q of queries) {
        const body = await call(
          { engine: "google", q: q.text, num: "10" },
          signal,
        );
        raw.push(body);
        for (const r of list(body.organic_results)) {
          const title = str(r.title);
          const url = str(r.link);
          if (title && url)
            hits.push({
              queryId: q.id,
              field: "organic_results",
              title,
              url,
              snippet: str(r.snippet),
              publishedAt: str(r.date),
            });
        }
      }
      return { ...emptyOutput(), reviews: hits, raw };
    },
  };

  return [web, shopping, lens, reviews];
}

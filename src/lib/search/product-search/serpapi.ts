import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ProviderError,
  createRateLimiter,
  emptyOutput,
  safeProviderError,
  skip,
  type ProviderInput,
  type ProviderOutput,
  type SearchProvider,
} from "./provider";
import {
  hostOf,
  imageReferenceUrl,
  isEvidenceUrl,
  isPublicImageUrl,
  sanitizeRaw,
} from "./url";
import type { BuiltQuery, RequestRecord } from "./types";

export interface SerpApiOptions {
  apiKey: string | undefined;
  country?: string;
  language?: string;
  timeoutMs?: number;
  maxRequestsPerHour?: number;
  minResultsBeforeFallback?: number;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Explicit isolated limiter for tests; live construction shares a process budget. */
  acquire?: () => void;
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
// One bucket per credential digest + endpoint, independent of factory lifetime.
// Each acquisition applies that caller's current cap; changing the cap doesn't
// erase history. No credentials are stored as map keys or returned diagnostics.
const budgets = new Map<string, ReturnType<typeof processBudget>>();
function processBudget() {
  const calls: number[] = [];
  return (max: number) => {
    const now = Date.now();
    while (calls.length && now - calls[0] >= 3_600_000) calls.shift();
    if (calls.length >= max) throw new ProviderError("RATE_LIMITED");
    calls.push(now);
  };
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const metadata = z
  .object({ status: z.enum(["Success", "Error", "Processing"]).optional() })
  .passthrough()
  .optional();
const common = { error: z.string().optional(), search_metadata: metadata };
// Engine-specific envelopes. Rows are validated independently below.
const webResponse = z
  .object({ ...common, organic_results: z.array(z.unknown()).optional() })
  .passthrough();
const shoppingResponse = z
  .object({ ...common, shopping_results: z.array(z.unknown()).optional() })
  .passthrough();
const lensResponse = z
  .object({
    ...common,
    visual_matches: z.array(z.unknown()).optional(),
    exact_matches: z.array(z.unknown()).optional(),
    organic_results: z.array(z.unknown()).optional(),
  })
  .passthrough();
const rowSchema = z
  .object({
    title: z.string().trim().min(1),
    link: z.string().optional(),
    product_link: z.string().optional(),
  })
  .passthrough();
const NO_RESULTS =
  /^(?:Google(?: Lens| Shopping)? (?:hasn't|has not) returned any results(?: for this query)?\.?|No results(?: found)?\.?)$/i;

export function createSerpApiProviders(
  options: SerpApiOptions,
): SearchProvider[] {
  const country = (options.country ?? "us").toLowerCase();
  const language = options.language ?? "en";
  const currencyHint = COUNTRY_CURRENCY[country] ?? null;
  const minResults = options.minResultsBeforeFallback ?? 3;
  const baseUrl = options.baseUrl ?? "https://serpapi.com/search.json";
  const budgetKey = hash(`${baseUrl}\0${options.apiKey ?? ""}`);
  const acquire =
    options.acquire ??
    (() => {
      let budget = budgets.get(budgetKey);
      if (!budget) {
        budget = processBudget();
        budgets.set(budgetKey, budget);
      }
      budget(options.maxRequestsPerHour ?? 50);
    });
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function execute(
    input: ProviderInput,
    output: ProviderOutput,
    engine: string,
    q: BuiltQuery | null,
    parse: (body: Record<string, unknown>, request: RequestRecord) => void,
  ) {
    if (input.signal.aborted) return;
    const image = engine === "google_lens" ? input.imageUrl : null;
    const request: RequestRecord = {
      id: `request_${hash(JSON.stringify([engine, q?.id ?? "lens-image", q?.text ?? image, country, language]))}`,
      queryId: q?.id ?? "lens-image",
      engine,
      queryText: q?.text ?? null,
      inputImageUrl: image ? imageReferenceUrl(image) : null,
      inputImageId: image ? `image_${hash(image)}` : null,
      country,
      language,
      executed: false,
      status: "pending",
      error: null,
      retrievedAt: new Date().toISOString(),
      discardedRows: 0,
    };
    output.requests!.push(request);
    const progress = () => {
      if (!input.signal.aborted) input.onProgress?.(output);
    };
    try {
      if (!options.apiKey?.trim()) throw new ProviderError("NOT_CONFIGURED");
      acquire();
      const url = new URL(baseUrl);
      url.searchParams.set("engine", engine);
      url.searchParams.set(
        engine === "google_lens" ? "country" : "gl",
        country,
      );
      url.searchParams.set("hl", language);
      if (q) url.searchParams.set("q", q.text);
      if (image) url.searchParams.set("url", image);
      url.searchParams.set("api_key", options.apiKey);
      request.executed = true;
      progress();
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(url, {
          signal: input.signal,
        });
      } catch {
        throw new ProviderError(
          input.signal.aborted ? "TIMEOUT" : "HTTP_ERROR",
        );
      }
      // Classify status before reading an error body; HTML 429 remains RATE_LIMITED.
      if (response.status === 401 || response.status === 403)
        throw new ProviderError("AUTH");
      if (response.status === 429) throw new ProviderError("RATE_LIMITED");
      if (!response.ok) throw new ProviderError("HTTP_ERROR");
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError(
          input.signal.aborted ? "TIMEOUT" : "INVALID_RESPONSE",
        );
      }
      const schema =
        engine === "google_lens"
          ? lensResponse
          : engine === "google_shopping"
            ? shoppingResponse
            : webResponse;
      const checked = schema.safeParse(body);
      if (!checked.success) throw new ProviderError("INVALID_RESPONSE");
      const data = checked.data;
      const noResults =
        typeof data.error === "string" && NO_RESULTS.test(data.error);
      if (data.error && !noResults) throw new ProviderError("PROVIDER_ERROR");
      if (
        !noResults &&
        data.search_metadata?.status &&
        data.search_metadata.status !== "Success"
      )
        throw new ProviderError("PROVIDER_ERROR");
      const sections =
        engine === "google_lens"
          ? ["exact_matches", "visual_matches", "organic_results"]
          : engine === "google_shopping"
            ? ["shopping_results"]
            : ["organic_results"];
      if (
        !noResults &&
        data.search_metadata?.status !== "Success" &&
        !sections.some((field) => Array.isArray(data[field]))
      )
        throw new ProviderError("INVALID_RESPONSE");
      if (input.signal.aborted) return;
      if (!noResults) parse(data, request);
      request.status = "ok";
      request.retrievedAt = new Date().toISOString();
      // Debug data is deliberately limited; no provider error/account metadata.
      output.raw.push(
        sanitizeRaw({
          search_parameters: {
            engine,
            ...(q ? { q: q.text } : { url: request.inputImageUrl }),
            country,
            hl: language,
          },
          ...Object.fromEntries(
            sections
              .filter((s) => Array.isArray(data[s]))
              .map((s) => [s, data[s]]),
          ),
        }),
      );
    } catch (error) {
      request.status = "error";
      request.error = safeProviderError(error);
    }
    output.discardedRows = output.requests!.reduce(
      (n, r) => n + r.discardedRows,
      0,
    );
    progress();
  }
  function rows(
    body: Record<string, unknown>,
    field: string,
    request: RequestRecord,
  ) {
    return ((body[field] ?? []) as unknown[]).flatMap((value) => {
      const parsed = rowSchema.safeParse(value);
      if (!parsed.success) {
        request.discardedRows++;
        return [];
      }
      return [parsed.data];
    });
  }
  function base(
    row: Record<string, unknown>,
    field: string,
    request: RequestRecord,
    shopping = false,
  ) {
    const direct = str(row.link);
    const product = str(row.product_link);
    const url = direct ?? (shopping ? product : null);
    if (!isEvidenceUrl(url)) {
      request.discardedRows++;
      return null;
    }
    const imageUrls = [
      ...new Set(
        [
          row.image,
          row.thumbnail,
          ...(Array.isArray(row.thumbnails) ? row.thumbnails : []),
          ...(Array.isArray(row.serpapi_thumbnails)
            ? row.serpapi_thumbnails
            : []),
        ].filter(isEvidenceUrl),
      ),
    ];
    return {
      queryId: request.queryId,
      requestId: request.id,
      field,
      title: String(row.title),
      url,
      position:
        typeof row.position === "number" &&
        Number.isInteger(row.position) &&
        row.position > 0
          ? row.position
          : null,
      imageUrls,
      providerProductId: str(row.product_id),
      brand: str(row.brand),
      variant: str(row.variant),
      snippet: str(row.snippet),
      urlType: (shopping &&
      !direct &&
      (hostOf(url) === "google.com" || hostOf(url).endsWith(".google.com"))
        ? "google_product_page"
        : "source_page") as "google_product_page" | "source_page",
    };
  }
  async function cascade(
    input: ProviderInput,
    engine: string,
    read: (
      body: Record<string, unknown>,
      request: RequestRecord,
      output: ProviderOutput,
    ) => void,
    reviews = false,
  ) {
    const output = emptyOutput();
    for (const q of input.queries) {
      if (input.signal.aborted) break;
      const count = output.pages.length + output.offers.length;
      if (!reviews && q.id === "brand-product" && count >= minResults) break;
      await execute(input, output, engine, q, (body, request) =>
        read(body, request, output),
      );
      const error = output.requests!.at(-1)?.error;
      if (
        error &&
        ["AUTH", "NOT_CONFIGURED", "RATE_LIMITED", "TIMEOUT"].includes(
          error.code,
        )
      )
        break;
    }
    return output;
  }
  const web: SearchProvider = {
    id: "serpapi:google",
    kind: "web",
    timeoutMs,
    search: (input) =>
      cascade(input, "google", (body, request, output) => {
        for (const row of rows(body, "organic_results", request)) {
          const hit = base(row, "organic_results", request);
          if (hit) output.pages.push(hit);
        }
      }),
  };
  const shopping: SearchProvider = {
    id: "serpapi:google_shopping",
    kind: "shopping",
    timeoutMs,
    search: (input) =>
      cascade(input, "google_shopping", (body, request, output) => {
        for (const row of rows(body, "shopping_results", request)) {
          const hit = base(row, "shopping_results", request, true);
          const merchant = str(row.source);
          if (!hit) continue;
          if (!merchant) {
            request.discardedRows++;
            continue;
          }
          output.offers.push({
            ...hit,
            merchant,
            price: str(row.price),
            currencyHint,
            listPrice: str(row.old_price),
            availability: str(row.stock_information),
            condition: str(row.second_hand_condition) ?? str(row.condition),
            shipping: str(row.delivery),
          });
        }
      }),
  };
  const lens: SearchProvider = {
    id: "serpapi:google_lens",
    kind: "visual",
    timeoutMs,
    async search(input) {
      if (!input.imageUrl) throw skip();
      if (!isPublicImageUrl(input.imageUrl))
        throw new ProviderError("INVALID_RESPONSE");
      // TODO(ProductSearch): agree image transport separately; no upload/hosting here.
      const output = emptyOutput();
      await execute(input, output, "google_lens", null, (body, request) => {
        for (const field of [
          "exact_matches",
          "visual_matches",
          "organic_results",
        ])
          for (const row of rows(body, field, request)) {
            const hit = base(row, field, request);
            if (!hit) continue;
            output.pages.push({
              ...hit,
              snippet: str(row.snippet) ?? str(row.source),
            });
            const price = record(row.price);
            const merchant = str(row.source);
            if (merchant && Object.keys(price).length)
              output.offers.push({
                ...hit,
                merchant,
                price: str(price.value),
                currencyHint: /^[A-Z]{3}$/.test(str(price.currency) ?? "")
                  ? str(price.currency)
                  : currencyHint,
                listPrice: null,
                availability:
                  typeof row.in_stock === "boolean"
                    ? row.in_stock
                      ? "in_stock"
                      : "out_of_stock"
                    : str(row.stock_information),
                condition: str(row.condition),
                shipping: null,
              });
          }
      });
      return output;
    },
  };
  const reviews: SearchProvider = {
    id: "serpapi:google_reviews",
    kind: "reviews",
    timeoutMs,
    search: (input) =>
      cascade(
        input,
        "google",
        (body, request, output) => {
          for (const row of rows(body, "organic_results", request)) {
            const hit = base(row, "organic_results", request);
            if (hit)
              output.reviews.push({ ...hit, publishedAt: str(row.date) });
          }
        },
        true,
      ),
  };
  return [web, shopping, lens, reviews];
}
// Kept available for consumers constructing an explicit isolated budget.
export { createRateLimiter };

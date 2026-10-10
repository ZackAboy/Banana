import { createHash } from "node:crypto";
import {
  ProviderError,
  emptyOutput,
  safeProviderError,
  validateProviderOutput,
  type SearchProvider,
} from "@/lib/search/product-search/provider";
import { canonicalizeUrl, hostOf } from "@/lib/search/product-search/url";
import { classifySource, redditParts } from "./classify";
import { buildReviewQueries, cleanReviewQuery } from "./queries";
import { assessRelevance } from "./relevance";
import type {
  ReviewDiscoveryResult,
  ReviewQueryInput,
  ReviewQueryPlan,
  ReviewSource,
} from "./types";

export interface ReviewDiscoveryOptions {
  /** Whole-discovery budget; earlier completed requests survive a timeout. */
  timeoutMs?: number;
  /** Cap on provider requests (one per planned query). */
  maxQueries?: number;
  /** Attach the provider's sanitized raw payloads (debugging, fixture recording). */
  includeRaw?: boolean;
  now?: () => Date;
}

const LEVEL_ORDER = ["exact_model", "product_name", "product_family", "weak"];
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/**
 * Conservative dedupe key: the same page reached through tracking parameters,
 * "www."/"old." hosts or a trailing slash. Reddit threads key on thread ID, so
 * different threads never merge, however similar their titles.
 */
export function sourceKey(url: string): string {
  const host = hostOf(url).replace(/^(?:old|new|np|m)\.(?=reddit\.com$)/, "");
  if (host === "reddit.com" || host === "redd.it") {
    const { threadId } = redditParts(url);
    if (threadId) return `reddit:${threadId}`;
  }
  const canonical = new URL(canonicalizeUrl(url));
  canonical.hash = "";
  const path = canonical.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${canonical.search}`;
}

/** "Nov 6, 2020" -> "2020-11-06". Relative text ("3 months ago") stays undated. */
export function absoluteDate(value: string | null): string | null {
  const m = value?.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return null;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  return date.getUTCDate() === Number(m[2])
    ? date.toISOString().slice(0, 10)
    : null;
}

/**
 * Discover review and discussion sources for a known product identity. Uses
 * any review-kind SearchProvider (normally Product Search's SerpApi review
 * adapter) with this module's own query plan. Never throws for provider
 * failures: they are recorded in providerRun.
 */
export async function discoverReviewSources(
  input: ReviewQueryInput,
  provider: SearchProvider,
  options: ReviewDiscoveryOptions = {},
): Promise<ReviewDiscoveryResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let finishedAt = startedAt;
  const query = cleanReviewQuery(input);
  const plan = buildReviewQueries(query).slice(0, options.maxQueries ?? 6);

  const controller = new AbortController();
  let output = validateProviderOutput(emptyOutput());
  let failure: ReturnType<typeof safeProviderError> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (provider.kind !== "reviews")
      throw new ProviderError("INVALID_RESPONSE");
    if (!plan.length) throw new ProviderError("SKIPPED");
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError("TIMEOUT"));
        controller.abort();
      }, timeoutMs);
    });
    const result = await Promise.race([
      provider.search({
        query: {
          brand: query.brand,
          product: query.product,
          modelNumber: query.modelNumber,
        },
        queries: plan.map((q) => ({
          id: q.id,
          text: q.text,
          fields: [],
          purpose: "reviews" as const,
        })),
        imageUrl: null,
        signal: controller.signal,
        onProgress: (value) => {
          if (!controller.signal.aborted)
            output = validateProviderOutput(value);
        },
      }),
      timeout,
    ]);
    output = validateProviderOutput(result);
  } catch (error) {
    failure = safeProviderError(error);
  } finally {
    clearTimeout(timer);
  }
  for (const request of output.requests) {
    if (request.status === "pending") {
      request.status = "error";
      request.error =
        failure ?? safeProviderError(new ProviderError("PROVIDER_ERROR"));
    }
    // Never pass through provider-authored diagnostic text.
    if (request.error)
      request.error = safeProviderError(new ProviderError(request.error.code));
  }
  failure ??= output.requests.find((r) => r.status === "error")?.error ?? null;
  finishedAt = now().toISOString();

  const merged = mergeHits(query, plan, provider.id, output, finishedAt);
  const ranked = [...merged].sort(
    (a, b) =>
      LEVEL_ORDER.indexOf(a.relevance.level) -
      LEVEL_ORDER.indexOf(b.relevance.level),
  );
  const exclusion = (s: ReviewSource) => [
    ...(s.relevance.level === "weak" ? s.relevance.notes : []),
    ...(s.classificationBasis === "retailer_listing"
      ? ["Retailer product listing, not a review page"]
      : []),
  ];
  const successes = output.requests.some((r) => r.status === "ok");
  return {
    query,
    queries: plan,
    sources: ranked.filter((s) => !exclusion(s).length),
    excluded: ranked
      .filter((s) => exclusion(s).length)
      .map((s) => ({ ...s, exclusionReasons: exclusion(s) })),
    providerRun: {
      provider: provider.id,
      status:
        failure?.code === "SKIPPED"
          ? "skipped"
          : failure
            ? successes || merged.length
              ? "partial"
              : "error"
            : "ok",
      requests: output.requests,
      discardedRows: output.discardedRows,
      error: failure,
    },
    startedAt,
    finishedAt,
    ...(options.includeRaw ? { raw: output.raw } : {}),
  };
}

/** One source per dedupe key; every discovery (query, request, URL) is kept. */
export function mergeHits(
  query: ReviewQueryInput,
  plan: ReviewQueryPlan[],
  providerId: string,
  output: ReturnType<typeof validateProviderOutput>,
  /** Used only when a custom provider reports no request record. */
  fallbackRetrievedAt: string,
): ReviewSource[] {
  const sources = new Map<string, ReviewSource>();
  for (const hit of output.reviews) {
    const request = output.requests.find((r) => r.id === hit.requestId);
    const discovery = {
      provider: providerId,
      engine: request?.engine ?? null,
      queryId: hit.queryId,
      queryText:
        plan.find((q) => q.id === hit.queryId)?.text ??
        request?.queryText ??
        null,
      requestId: hit.requestId,
      position: hit.position,
      url: hit.url,
      retrievedAt: request?.retrievedAt ?? fallbackRetrievedAt,
    };
    const key = sourceKey(hit.url);
    const existing = sources.get(key);
    if (existing) {
      if (
        !existing.discoveredBy.some(
          (d) =>
            d.queryId === discovery.queryId &&
            d.requestId === discovery.requestId &&
            d.url === discovery.url,
        )
      )
        existing.discoveredBy.push(discovery);
      existing.snippet ??= hit.snippet;
      existing.publishedText ??= hit.publishedAt;
      existing.publishedDate ??= absoluteDate(hit.publishedAt);
      continue;
    }
    const classification = classifySource(hit.url, hit.title, query.brand);
    sources.set(key, {
      id: `review_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
      sourceType: classification.sourceType,
      classificationBasis: classification.basis,
      title: hit.title,
      url: hit.url,
      domain: hostOf(hit.url),
      snippet: hit.snippet,
      publishedText: hit.publishedAt,
      publishedDate: absoluteDate(hit.publishedAt),
      reddit: classification.reddit,
      relevance: assessRelevance(query, hit.title, hit.snippet),
      discoveredBy: [discovery],
    });
  }
  // A later discovery may add a snippet; reassess with everything known.
  for (const source of sources.values()) {
    source.relevance = assessRelevance(query, source.title, source.snippet);
    if (source.reddit && !source.reddit.threadId)
      source.relevance.notes.push(
        "Subreddit front page, not a specific thread",
      );
  }
  return [...sources.values()];
}

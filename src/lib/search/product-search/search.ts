import { buildQueries, cleanQuery } from "./query";
import { computeMatchSignals, dice, tokens } from "./signals";
import {
  extractModelNumbers,
  matchModelNumber,
  normalizeModelNumber,
} from "./model-number";
import { parsePrice } from "./price";
import { canonicalizeUrl, hostOf, isHttpUrl } from "./url";
import { classifySource } from "./sources";
import {
  ProviderError,
  type OfferHit,
  type PageHit,
  type ProviderOutput,
  type ReviewHit,
  type SearchProvider,
} from "./provider";
import type {
  BuiltQuery,
  DiscoveredReviewSource,
  Evidence,
  ExternalOffer,
  ExternalProductCandidate,
  OfferCondition,
  ProductSearchQuery,
  ProductSearchResult,
  ProviderRef,
  ProviderRun,
} from "./types";

export interface ProductSearchOptions {
  /** Publicly reachable image URL for visual providers. Without it they are skipped. */
  imageUrl?: string | null;
  /** Per-provider budget. A slow provider is reported, never awaited forever. */
  timeoutMs?: number;
  /** Include each provider's raw payloads in the result. */
  includeRaw?: boolean;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SAME_ITEM_TITLE_OVERLAP = 0.5;

/**
 * Run every provider concurrently and merge what they found. One provider
 * failing, timing out or being skipped never fails the search; its run is
 * recorded with the error and the other results are returned.
 *
 * Item order is provider order then response order. It is not a ranking, and
 * nothing here decides which candidate is correct.
 */
export async function runProductSearch(
  input: ProductSearchQuery,
  providers: SearchProvider[],
  options: ProductSearchOptions = {},
): Promise<ProductSearchResult> {
  const now = options.now ?? (() => new Date());
  const query = cleanQuery(input);
  const queries = buildQueries(query);
  const startedAt = now().toISOString();

  const runs = await Promise.all(
    providers.map((provider) =>
      runProvider(provider, query, queries, options, now),
    ),
  );

  const merger = new Merger(query);
  for (const { provider, output, retrievedAt } of runs) {
    if (!output) continue;
    const ref = (queryId: string): ProviderRef => ({
      provider: provider.id,
      kind: provider.kind,
      queryId,
      retrievedAt,
    });
    output.pages.forEach((hit) => merger.addPage(hit, ref(hit.queryId)));
    output.offers.forEach((hit) => merger.addOffer(hit, ref(hit.queryId)));
    output.reviews.forEach((hit) => merger.addReview(hit, ref(hit.queryId)));
  }

  const result: ProductSearchResult = {
    query,
    queries,
    ...merger.finish(),
    providerRuns: runs.map((r) => r.run),
    startedAt,
    finishedAt: now().toISOString(),
  };
  if (options.includeRaw)
    result.raw = Object.fromEntries(
      runs.map((r) => [r.provider.id, r.output?.raw ?? []]),
    );
  return result;
}

async function runProvider(
  provider: SearchProvider,
  query: ProductSearchQuery,
  queries: BuiltQuery[],
  options: ProductSearchOptions,
  now: () => Date,
) {
  const relevant = queries.filter((q) =>
    provider.kind === "reviews"
      ? q.purpose === "reviews"
      : q.purpose === "product",
  );
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Settle as TIMEOUT before aborting, so the provider's abort error loses the race.
      reject(
        new ProviderError("TIMEOUT", `No response within ${timeoutMs} ms.`),
      );
      controller.abort();
    }, timeoutMs);
  });
  const base = {
    provider: provider.id,
    kind: provider.kind,
    queryIds: relevant.map((q) => q.id),
  };
  try {
    if (!relevant.length && provider.kind !== "visual")
      throw new ProviderError(
        "SKIPPED",
        "No usable query fields for this provider.",
      );
    const output = await Promise.race([
      provider.search({
        query,
        queries: relevant,
        imageUrl: options.imageUrl ?? null,
        signal: controller.signal,
      }),
      timeout,
    ]);
    const run: ProviderRun = {
      ...base,
      status: "ok",
      durationMs: Math.round(performance.now() - started),
      itemCount:
        output.pages.length + output.offers.length + output.reviews.length,
      error: null,
    };
    return { provider, output, run, retrievedAt: now().toISOString() };
  } catch (error) {
    const known = error instanceof ProviderError;
    const run: ProviderRun = {
      ...base,
      status: known && error.code === "SKIPPED" ? "skipped" : "error",
      durationMs: Math.round(performance.now() - started),
      itemCount: 0,
      error: {
        code: known ? error.code : "PROVIDER_ERROR",
        message: (error instanceof Error && error.message
          ? error.message
          : "Unknown provider failure."
        ).slice(0, 300),
      },
    };
    return {
      provider,
      output: null as ProviderOutput | null,
      run,
      retrievedAt: now().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

interface CandidateDraft {
  title: string;
  brand: string | null;
  urls: string[];
  foundBy: ProviderRef[];
  evidence: Evidence[];
  texts: { title: string; snippet: string }[];
}

const pushUnique = <T>(list: T[], item: T, same: (a: T) => boolean) => {
  if (!list.some(same)) list.push(item);
};
const sameRef = (a: ProviderRef, b: ProviderRef) =>
  a.provider === b.provider && a.queryId === b.queryId;

function mapCondition(raw: string | null, title: string): OfferCondition {
  const text = `${raw ?? ""} ${raw ? "" : title}`.toLowerCase();
  if (/refurb|renewed|reconditioned|remanufactured/.test(text))
    return "refurbished";
  if (/\bused\b|pre-?owned|second[- ]hand|open[- ]box/.test(text))
    return "used";
  if (raw && /\bnew\b/.test(text)) return "new";
  return "unknown";
}

class Merger {
  private candidates = new Map<string, CandidateDraft>();
  private offers: ExternalOffer[] = [];
  private reviews = new Map<string, DiscoveredReviewSource>();

  constructor(private readonly query: ProductSearchQuery) {}

  addPage(hit: PageHit, ref: ProviderRef) {
    if (!isHttpUrl(hit.url) || !hit.title.trim()) return;
    const canonical = canonicalizeUrl(hit.url);
    const draft = this.candidates.get(canonical) ?? {
      title: hit.title.trim(),
      brand: hit.brand,
      urls: [],
      foundBy: [],
      evidence: [],
      texts: [],
    };
    draft.brand ??= hit.brand;
    pushUnique(draft.urls, hit.url, (u) => u === hit.url);
    pushUnique(draft.foundBy, ref, (r) => sameRef(r, ref));
    draft.texts.push({ title: hit.title, snippet: hit.snippet ?? "" });
    for (const evidence of this.evidenceFor(hit, ref))
      pushUnique(
        draft.evidence,
        evidence,
        (e) =>
          e.claim === evidence.claim &&
          e.provider === evidence.provider &&
          e.field === evidence.field &&
          e.sourceUrl === evidence.sourceUrl,
      );
    this.candidates.set(canonical, draft);
  }

  /** Field-level observations: what in this source matches (or differs from) the query. */
  private evidenceFor(hit: PageHit, ref: ProviderRef): Evidence[] {
    const fields = [
      { field: `${hit.field}.title`, text: hit.title },
      { field: `${hit.field}.snippet`, text: hit.snippet ?? "" },
    ].filter((f) => f.text.trim());
    const base = {
      sourceUrl: hit.url,
      provider: ref.provider,
      queryId: ref.queryId,
      retrievedAt: ref.retrievedAt,
    };
    const out: Evidence[] = [];
    const { modelNumber, brand } = this.query;
    for (const { field, text } of fields) {
      const add = (claim: string) =>
        out.push({ ...base, claim, field, snippet: text });
      if (modelNumber) {
        const match = matchModelNumber(modelNumber, text);
        const target = normalizeModelNumber(modelNumber);
        if (match.exact)
          add(`Exact model number "${modelNumber}" appears in source`);
        for (const seen of match.seen) {
          const normalized = normalizeModelNumber(seen);
          if (normalized === target && !match.exact)
            add(
              `Model number variant "${seen}" matches "${modelNumber}" after normalisation`,
            );
          else if (match.suffixVariants.includes(seen))
            add(
              `Model number "${seen}" extends "${modelNumber}" with a suffix`,
            );
          else if (normalized !== target)
            add(`Different model number "${seen}" appears in source`);
        }
      } else {
        for (const seen of extractModelNumbers(text))
          add(`Model number "${seen}" appears in source`);
      }
      const brandTokens = brand ? tokens(brand) : [];
      const textTokens = new Set(tokens(text));
      if (brandTokens.length && brandTokens.every((t) => textTokens.has(t)))
        add(`Brand "${brand}" appears in source`);
    }
    if (!out.length)
      out.push({
        ...base,
        claim:
          "Returned for the query; no query field found in title or snippet",
        field: hit.field,
        snippet: hit.title,
      });
    return out;
  }

  addOffer(hit: OfferHit, ref: ProviderRef) {
    if (!isHttpUrl(hit.url) || !hit.title.trim() || !hit.merchant.trim())
      return;
    const canonical = canonicalizeUrl(hit.url);
    const price = hit.price
      ? parsePrice(hit.price, hit.currencyHint)
      : { amountMinor: null, currency: hit.currencyHint, original: null };
    const listPrice = hit.listPrice
      ? parsePrice(hit.listPrice, price.currency ?? hit.currencyHint)
      : null;
    const offer: ExternalOffer = {
      merchant: hit.merchant.trim(),
      title: hit.title.trim(),
      priceMinor: price.amountMinor,
      currency: price.currency,
      originalPrice: price.original,
      listPriceMinor:
        listPrice && listPrice.currency === price.currency
          ? listPrice.amountMinor
          : null,
      availability: hit.availability,
      condition: mapCondition(hit.condition, hit.title),
      shipping: hit.shipping,
      url: hit.url,
      canonicalUrl: canonical,
      foundBy: [ref],
      matchSignals: computeMatchSignals(this.query, hit.title, ""),
    };
    const merchantKey = (o: ExternalOffer) =>
      o.merchant.toLowerCase().replace(/[^a-z0-9]/g, "");
    const duplicate = this.offers.find(
      (o) =>
        o.canonicalUrl === canonical ||
        (merchantKey(o) === merchantKey(offer) &&
          o.priceMinor !== null &&
          o.priceMinor === offer.priceMinor &&
          o.currency === offer.currency &&
          o.condition === offer.condition &&
          // Same store and price is not enough: stores sell several items at one price.
          dice(tokens(o.title), tokens(offer.title)) >=
            SAME_ITEM_TITLE_OVERLAP),
    );
    if (duplicate) {
      pushUnique(duplicate.foundBy, ref, (r) => sameRef(r, ref));
      duplicate.availability ??= offer.availability;
      duplicate.shipping ??= offer.shipping;
      duplicate.listPriceMinor ??= offer.listPriceMinor;
      return;
    }
    this.offers.push(offer);
  }

  addReview(hit: ReviewHit, ref: ProviderRef) {
    if (!isHttpUrl(hit.url) || !hit.title.trim()) return;
    const canonical = canonicalizeUrl(hit.url);
    const existing = this.reviews.get(canonical);
    if (existing) {
      pushUnique(existing.foundBy, ref, (r) => sameRef(r, ref));
      existing.snippet ??= hit.snippet;
      return;
    }
    this.reviews.set(canonical, {
      title: hit.title.trim(),
      url: hit.url,
      canonicalUrl: canonical,
      sourceType: classifySource(hit.url, this.query.brand),
      domain: hostOf(hit.url),
      snippet: hit.snippet,
      publishedAt: hit.publishedAt,
      foundBy: [ref],
    });
  }

  finish() {
    const candidates: ExternalProductCandidate[] = [];
    for (const [canonicalUrl, draft] of this.candidates) {
      const title = draft.texts.map((t) => t.title).join("\n");
      const text = draft.texts.map((t) => t.snippet).join("\n");
      const matchSignals = computeMatchSignals(
        this.query,
        draft.title,
        `${title}\n${text}`,
      );
      candidates.push({
        title: draft.title,
        brand: draft.brand,
        modelNumbersSeen: matchSignals.modelNumbersSeen,
        canonicalUrl,
        urls: draft.urls,
        foundBy: draft.foundBy,
        matchSignals,
        evidence: draft.evidence,
      });
    }
    return {
      candidates,
      offers: this.offers,
      reviewSources: [...this.reviews.values()],
    };
  }
}

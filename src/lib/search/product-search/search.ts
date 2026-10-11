import "server-only";
import type { ImageInput } from "@/lib/providers/interfaces";
import { createHash } from "node:crypto";
import { buildQueries, cleanQuery, queryIdentifiers } from "./query";
import { computeMatchSignals, tokens } from "./signals";
import { identifierObservations } from "./model-number";
import { parsePrice } from "./price";
import { canonicalizeUrl, hostOf, sanitizeRaw } from "./url";
import { classifySource } from "./sources";
import {
  ProviderError,
  emptyOutput,
  safeProviderError,
  validateProviderOutput,
  type SearchProvider,
  type ValidatedProviderOutput,
} from "./provider";
import {
  productSearchResultSchema,
  type BuiltQuery,
  type Evidence,
  type ExternalOffer,
  type ExternalProductCandidate,
  type OfferCondition,
  type ProductSearchQuery,
  type ProductSearchResult,
  type ProviderRef,
  type ProviderRun,
  type SourceObservation,
  type DiscoveredReviewSource,
} from "./types";

export interface ProductSearchOptions {
  images?: ImageInput[];
  imageUrl?: string | null;
  timeoutMs?: number;
  includeReviews?: boolean;
  /** Sanitized debug payloads only; normalized observations are authoritative. */
  includeRaw?: boolean;
  now?: () => Date;
}
export async function runProductSearch(
  input: ProductSearchQuery,
  providers: SearchProvider[],
  options: ProductSearchOptions = {},
): Promise<ProductSearchResult> {
  const now = options.now ?? (() => new Date());
  const query = cleanQuery(input);
  const queries = buildQueries(query, options.includeReviews === true);
  const startedAt = now().toISOString();
  const runs = await Promise.all(
    providers.flatMap((provider) =>
      provider.kind === "visual" && options.images?.length
        ? options.images.map((image, index) =>
            runProvider(
              provider,
              query,
              queries,
              options,
              now,
              image,
              index + 1,
            ),
          )
        : [runProvider(provider, query, queries, options, now)],
    ),
  );
  const merger = new Merger(query);
  for (const { provider, output, sourceImageIndex } of runs) {
    const ref = (hit: {
      queryId: string;
      requestId: string | null;
    }): ProviderRef => {
      const request = output.requests.find((r) => r.id === hit.requestId);
      return {
        provider: provider.id,
        kind: provider.kind,
        engine: request?.engine ?? null,
        queryId: hit.queryId,
        requestId: hit.requestId,
        retrievedAt: request?.retrievedAt ?? now().toISOString(),
        ...(sourceImageIndex ? { sourceImageIndex } : {}),
      };
    };
    for (const hit of output.pages) merger.addPage(hit, ref(hit));
    // Shopping observations also supply candidate identities/images for retrieval.
    for (const hit of output.offers) {
      merger.addPage(hit, ref(hit));
      merger.addOffer(hit, ref(hit));
    }
    for (const hit of output.reviews) merger.addReview(hit, ref(hit));
  }
  const result = {
    query,
    queries,
    ...merger.finish(),
    providerRuns: runs.map((r) => r.run),
    startedAt,
    finishedAt: now().toISOString(),
    ...(options.includeRaw
      ? {
          raw: Object.fromEntries(
            runs.map((r) => [r.provider.id, r.output.raw.map(sanitizeRaw)]),
          ),
        }
      : {}),
  };
  const checked = productSearchResultSchema.safeParse(result);
  if (!checked.success) throw new ProviderError("INVALID_RESPONSE");
  return checked.data;
}
async function runProvider(
  provider: SearchProvider,
  query: ProductSearchQuery,
  queries: BuiltQuery[],
  options: ProductSearchOptions,
  now: () => Date,
  image?: ImageInput,
  sourceImageIndex?: number,
) {
  const relevant = queries.filter((q) =>
    provider.kind === "reviews"
      ? q.purpose === "reviews"
      : q.purpose === "product",
  );
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 10_000;
  const started = performance.now();
  let output = validateProviderOutput(emptyOutput());
  let failure: ReturnType<typeof safeProviderError> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      (!relevant.length && provider.kind !== "visual") ||
      (provider.kind === "reviews" && !options.includeReviews)
    )
      throw new ProviderError("SKIPPED");
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError("TIMEOUT"));
        controller.abort();
      }, timeoutMs);
    });
    const result = await Promise.race([
      provider.search({
        query,
        queries: relevant,
        imageUrl: options.imageUrl ?? null,
        image,
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
  // A timeout may interrupt a cascade after earlier completed requests. Preserve
  // the validated snapshot and mark the actual outstanding request honestly.
  for (const request of output.requests)
    if (request.status === "pending") {
      request.status = "error";
      request.error =
        failure ?? safeProviderError(new ProviderError("PROVIDER_ERROR"));
      request.retrievedAt = now().toISOString();
    }
  // Never trust custom provider-supplied diagnostic text.
  for (const request of output.requests)
    if (request.error)
      request.error = safeProviderError(new ProviderError(request.error.code));
  const requestFailure = output.requests.find(
    (r) => r.status === "error",
  )?.error;
  failure ??= requestFailure ?? null;
  const itemCount =
    output.pages.length + output.offers.length + output.reviews.length;
  const successes = output.requests.some((r) => r.status === "ok");
  const run: ProviderRun = {
    provider: provider.id,
    kind: provider.kind,
    status:
      failure?.code === "SKIPPED"
        ? "skipped"
        : failure
          ? successes || itemCount > 0
            ? "partial"
            : "error"
          : "ok",
    queryIds: [
      ...new Set(
        output.requests.filter((r) => r.executed).map((r) => r.queryId),
      ),
    ],
    requests: output.requests,
    discardedRows: output.discardedRows,
    durationMs: Math.round(performance.now() - started),
    itemCount,
    error: failure,
    ...(sourceImageIndex ? { sourceImageIndex } : {}),
  };
  return { provider, output, run, sourceImageIndex };
}

const unique = <T>(items: T[]): T[] => [
  ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
];
const refKey = (ref: ProviderRef) => JSON.stringify(ref);
function mapCondition(raw: string | null, title: string): OfferCondition {
  const value = (raw ?? title).toLowerCase();
  if (/\b(?:not|non)[ -]+(?:new|used|refurbished|renewed)\b/.test(value))
    return "unknown";
  if (/\bopen[ -]box\b/.test(value)) return "open_box";
  if (
    /\b(?:refurbished|refurb|renewed|reconditioned|remanufactured)\b/.test(
      value,
    )
  )
    return "refurbished";
  if (/\bused\b|\bpre[ -]?owned\b|\bsecond[ -]hand\b/.test(value))
    return "used";
  // Only explicit provider condition wording supports new; title mentions don't.
  if (raw && /^(?:brand[ -])?new(?: condition)?$/.test(value.trim()))
    return "new";
  return "unknown";
}
type Page = ValidatedProviderOutput["pages"][number];
type Offer = ValidatedProviderOutput["offers"][number];
type Review = ValidatedProviderOutput["reviews"][number];
class Merger {
  private candidates = new Map<string, SourceObservation[]>();
  private offers = new Map<string, ExternalOffer>();
  private reviews = new Map<string, DiscoveredReviewSource>();
  constructor(private readonly query: ProductSearchQuery) {}
  private observation(hit: Page, ref: ProviderRef): SourceObservation {
    const fields = [
      { field: `${hit.field}.title`, text: hit.title },
      { field: `${hit.field}.snippet`, text: hit.snippet ?? "" },
    ];
    const identifiers = fields.flatMap(({ field, text }) =>
      queryIdentifiers(this.query).flatMap((id) =>
        identifierObservations(id, text, field),
      ),
    );
    const present = new Set(tokens(`${hit.title}\n${hit.snippet ?? ""}`));
    const mentioned = (value: string | undefined) =>
      value &&
      tokens(value).length &&
      tokens(value).every((token) => present.has(token))
        ? value
        : null;
    return {
      ...ref,
      field: hit.field,
      title: hit.title,
      url: hit.url,
      domain: hostOf(hit.url),
      position: hit.position,
      snippet: hit.snippet,
      imageUrls: hit.imageUrls,
      providerProductId: hit.providerProductId,
      urlType: hit.urlType,
      brandClue: hit.brand ?? mentioned(this.query.brand),
      variantClue: hit.variant ?? mentioned(this.query.variant),
      identifiers,
    };
  }
  addPage(hit: Page, ref: ProviderRef) {
    const key = canonicalizeUrl(hit.url);
    const list = this.candidates.get(key) ?? [];
    list.push(this.observation(hit, ref));
    this.candidates.set(key, list);
  }
  addOffer(hit: Offer, ref: ProviderRef) {
    const source = this.observation(hit, ref);
    const observation = {
      ...source,
      merchant: hit.merchant,
      displayedPrice: hit.price,
      currencyHint: hit.currencyHint,
      displayedListPrice: hit.listPrice,
      conditionText: hit.condition,
      availability: hit.availability,
      shipping: hit.shipping,
    };
    const canonicalUrl = canonicalizeUrl(hit.url);
    // Equivalence is deliberately strict. Every material observed field must be
    // identical; only known tracking parameters and provenance may differ.
    const key = JSON.stringify({
      ...observation,
      provider: undefined,
      kind: undefined,
      engine: undefined,
      queryId: undefined,
      requestId: undefined,
      retrievedAt: undefined,
      position: undefined,
      field: undefined,
      url: canonicalUrl,
    });
    const existing = this.offers.get(key);
    if (existing) {
      existing.observations.push(observation);
      existing.foundBy = unique([...existing.foundBy, ref]);
      return;
    }
    const price = parsePrice(hit.price ?? "", hit.currencyHint);
    const list = hit.listPrice
      ? parsePrice(hit.listPrice, hit.currencyHint)
      : null;
    this.offers.set(key, {
      merchant: hit.merchant,
      title: hit.title,
      priceMinor: price.amountMinor,
      currency: price.currency,
      originalPrice: hit.price,
      listPriceMinor:
        list && list.currency === price.currency ? list.amountMinor : null,
      availability: hit.availability,
      condition: mapCondition(hit.condition, hit.title),
      shipping: hit.shipping,
      url: hit.url,
      canonicalUrl,
      foundBy: [ref],
      observations: [observation],
      matchSignals: computeMatchSignals(
        this.query,
        hit.title,
        hit.snippet ?? "",
      ),
    });
  }
  addReview(hit: Review, ref: ProviderRef) {
    const canonicalUrl = canonicalizeUrl(hit.url);
    // Preserve different review snippets/dates rather than silently coalescing.
    const key = JSON.stringify([
      canonicalUrl,
      hit.title,
      hit.snippet,
      hit.publishedAt,
    ]);
    const existing = this.reviews.get(key);
    const observation = this.observation(hit, ref);
    if (existing) {
      existing.observations.push(observation);
      existing.foundBy = unique([...existing.foundBy, ref]);
      return;
    }
    this.reviews.set(key, {
      title: hit.title,
      url: hit.url,
      canonicalUrl,
      sourceType: classifySource(hit.url, this.query.brand),
      domain: hostOf(hit.url),
      snippet: hit.snippet,
      publishedAt: hit.publishedAt,
      foundBy: [ref],
      observations: [observation],
    });
  }
  private evidence(observation: SourceObservation): Evidence[] {
    const entries = [
      { field: `${observation.field}.title`, text: observation.title },
      {
        field: `${observation.field}.snippet`,
        text: observation.snippet ?? "",
      },
    ].filter((e) => e.text);
    return entries.map(({ field, text }) => ({
      claim:
        "Source text observation; identifier mentions do not establish product association.",
      sourceUrl: observation.url,
      provider: observation.provider,
      queryId: observation.queryId,
      requestId: observation.requestId,
      field,
      snippet: text,
      retrievedAt: observation.retrievedAt,
    }));
  }
  finish() {
    const candidates: ExternalProductCandidate[] = [];
    for (const [canonicalUrl, observations] of this.candidates) {
      // Deterministic representative; all differing source observations survive.
      observations.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      const first = [...observations].sort((a, b) =>
        a.title.localeCompare(b.title),
      )[0];
      const identifiers = unique(observations.flatMap((o) => o.identifiers));
      const signals = observations.map((o) =>
        computeMatchSignals(this.query, o.title, o.snippet ?? ""),
      );
      const matchSignals = {
        ...computeMatchSignals(this.query, first.title, first.snippet ?? ""),
        exactModelNumber:
          signals[0].exactModelNumber === null
            ? null
            : signals.some((s) => s.exactModelNumber),
        normalizedModelNumber:
          signals[0].normalizedModelNumber === null
            ? null
            : signals.some((s) => s.normalizedModelNumber),
        modelNumbersSeen: unique(signals.flatMap((s) => s.modelNumbersSeen)),
        modelNumberSuffixVariants: unique(
          signals.flatMap((s) => s.modelNumberSuffixVariants),
        ),
      };
      candidates.push({
        id: `candidate_${createHash("sha256").update(canonicalUrl).digest("hex")}`,
        title: first.title,
        brand: first.brandClue,
        variant: first.variantClue,
        domain: first.domain,
        imageUrls: unique(observations.flatMap((o) => o.imageUrls)).sort(),
        identifierObservations: identifiers,
        modelNumbersSeen: matchSignals.modelNumbersSeen,
        canonicalUrl,
        urls: unique(observations.map((o) => o.url)).sort(),
        foundBy: unique(
          observations.map(
            ({
              provider,
              kind,
              engine,
              queryId,
              requestId,
              retrievedAt,
              sourceImageIndex,
            }) => ({
              provider,
              kind,
              engine,
              queryId,
              requestId,
              retrievedAt,
              ...(sourceImageIndex ? { sourceImageIndex } : {}),
            }),
          ),
        ).sort((a, b) => refKey(a).localeCompare(refKey(b))),
        observations,
        matchSignals,
        evidence: observations.flatMap((o) => this.evidence(o)),
      });
    }
    // TODO(ProductSearch): coordinate bounded candidate image acquisition/IDs with
    // retrieval. No downloading or OCR/retrieval/fusion implementation here.
    return {
      candidates,
      offers: [...this.offers.values()],
      reviewSources: [...this.reviews.values()],
    };
  }
}

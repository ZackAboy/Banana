# External product search

Workstream: Product Search (`feature/product-search`). Starts from a **textual**
product candidate and returns external evidence, offers and review sources. It
does not identify products from images and never decides which candidate is
correct. Fusion does that.

```ts
import { runProductSearch } from "@/lib/search/product-search";
import { liveProductSearchProviders } from "@/lib/search/product-search/config";

const result = await runProductSearch(
  {
    brand: "Sony",
    product: "DualSense Wireless Controller",
    modelNumber: "CFI-ZCT2W",
  },
  liveProductSearchProviders(),
  { imageUrl: null }, // Lens runs only with a public image URL
);
```

## Plan

1. Build queries: quoted model number + brand, then brand + product, then two
   review-discovery queries.
2. Run every provider concurrently, each with a timeout. Record a run per
   provider (`ok`, `error` or `skipped`). One failure never fails the search.
3. Providers return light hits (pages, offers, review links) plus raw payloads.
   Everything else happens once, in `search.ts`, whichever provider ran:
   - match signals and field-level evidence,
   - price parsing,
   - condition mapping,
   - source classification,
   - URL canonicalisation and deduplication.
4. The output carries raw signals only: no status, verdict, score or ranking.

### Findings from live runs (SerpApi, 2026-10-10, DualSense query)

- **The exact model query works well.** `"CFI-ZCT2W" Sony` returned 9
  relevant pages, all but one containing the exact model number. That was
  enough that the fallback query wasn't needed.
- **Review queries use the product name, not the model number.** An unquoted
  `… CFI-ZCT2W review` made Google return pages about "CFI" (flight
  instructors, finance courses). A model number is used only when there's no
  product name, and then it's quoted.
- **`site:reddit.com` returned no Reddit results through SerpApi.** It
  returned generic Sony pages instead. The plain keyword (`… reddit`) returned
  9 Reddit threads.
- **Google Shopping is noisy.** Offers link to Google product pages, not
  merchants, and include unrelated listings (one at $2,899). Most shopping
  titles don't contain the model number, so their
  `matchSignals.exactModelNumber` is `false`. Fusion should use that signal
  rather than trusting every offer.
- **Different colours share one model number**, so they appear as separate
  candidates with the same exact match (e.g. white, Starlight Blue,
  Camouflage).

## Files

| File              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `types.ts`        | Zod schemas and types for the module's output (see below)          |
| `provider.ts`     | `SearchProvider` interface, hit shapes, errors, rate limiter       |
| `search.ts`       | `runProductSearch`: orchestration, evidence, merge/dedupe          |
| `query.ts`        | Query building                                                     |
| `model-number.ts` | Model-number normalisation, extraction and variant matching        |
| `signals.ts`      | Raw match signals between a query and a source                     |
| `price.ts`        | Locale-tolerant price parsing into minor units                     |
| `url.ts`          | URL canonicalisation                                               |
| `sources.ts`      | Review source classification (reddit / review site / spec / other) |
| `serpapi.ts`      | SerpApi adapters: web, shopping, Lens, reviews                     |
| `config.ts`       | Env-driven configuration and live provider factory                 |

## Data model (`types.ts`)

- **ProductSearchQuery**: `brand?`, `product?` and `modelNumber?`. Any of them
  may be missing.
- **ProviderRef**: `provider`, `kind` (web/shopping/visual/reviews), `queryId`
  and `retrievedAt`. Every item carries one or more of these.
- **MatchSignals**:
  - `exactModelNumber` and `normalizedModelNumber`.
  - `modelNumberSuffixVariants`.
  - `modelNumbersSeen`: the original strings as written.
  - `brandMatch`.
  - `productTermsMatched` and `productTermsMissing`.
  - `titleTokenOverlap`: a 0..1 Dice overlap, not a probability.
  - `null` means the query lacked that field.
- **Evidence**: `claim`, `sourceUrl`, `provider`, `queryId`, `field`
  (e.g. `organic_results.snippet`), `snippet` and `retrievedAt`. Claims are
  observations:
  - "Exact model number … appears in source"
  - "Model number variant … matches after normalisation"
  - "… extends … with a suffix"
  - "Different model number … appears in source"
  - "Brand … appears in source"
- **ExternalProductCandidate**:
  - `title`, plus `brand` (only when a provider states it).
  - `modelNumbersSeen`.
  - `canonicalUrl`, plus `urls` (every original URL merged into it).
  - `foundBy` (every provider/query that returned it).
  - `matchSignals` and `evidence`.
- **ExternalOffer**:
  - `merchant` and `title`.
  - `priceMinor` (integer minor units), `currency` (ISO 4217) and
    `originalPrice` (the price string as shown).
  - `listPriceMinor`, `availability`, `condition`
    (new/used/refurbished/unknown) and `shipping`.
  - `url` and `canonicalUrl`.
  - `foundBy` and `matchSignals`.
- **DiscoveredReviewSource**:
  - `title`, `url` and `canonicalUrl`.
  - `sourceType` (`reddit` | `review_site` | `manufacturer_spec` | `other`)
    and `domain`.
  - `snippet` and `publishedAt` (raw provider text, e.g. "3 months ago").
  - `foundBy`.
- **ProductSearchResult**:
  - `query` (cleaned) and `queries` (built).
  - `candidates`, `offers` and `reviewSources`.
  - `providerRuns` (status, error code/message, duration, item count, query IDs
    per provider).
  - `startedAt` and `finishedAt`.
  - Optional `raw` payloads, only with `includeRaw`.

Rules the code enforces:

- **Conflicts are kept.** If Lens suggests a DualShock 4 and the model-number
  search finds a DualSense, both candidates appear, each attributed to its
  provider. Mismatching model numbers become explicit evidence.
- **Currencies are never converted or guessed.** A bare `$` or `kr` resolves
  only through the market currency hint (from `PRODUCT_SEARCH_COUNTRY`).
  Otherwise `currency` is `null`. Minor-unit digits come from `Intl`, so JPY
  has 0 and USD has 2.
- **Model-number variants are signals, not merges.** `cfi zct2w` normalises to
  match `CFI-ZCT2W`. `CFI-ZCT2W01` is reported as a suffix variant.
  `CFI-ZCT1W` is a different model.
- **Deduplication:**
  - Candidates and review sources merge on canonical URL.
  - Offers merge on canonical URL, or on the same merchant + price + currency
    - condition.
  - Merged items keep every `foundBy` entry.
- **Canonical URLs:** `https` and a lower-case host without `www.`/`m.`/`old.`.
  Tracking parameters are removed (`utm_*`, `gclid`, `fbclid`, `srsltid`,
  `tag`, `ref`, …), the remaining parameters are sorted, and there is no
  fragment or trailing slash. Amazon URLs reduce to `/dp/<ASIN>`.
- **Order isn't a ranking.** Items appear in provider order, then response
  order.
- **Dropped hits:** hits without an http(s) URL or a title are dropped.

## Provider interface (`provider.ts`)

```ts
interface SearchProvider {
  id: string; // e.g. "serpapi:google_shopping"
  kind: "web" | "shopping" | "visual" | "reviews";
  search(input: {
    query: ProductSearchQuery;
    queries: BuiltQuery[]; // only those relevant to this kind, in priority order
    imageUrl: string | null;
    signal: AbortSignal; // aborted on timeout
  }): Promise<{
    pages: PageHit[];
    offers: OfferHit[];
    reviews: ReviewHit[];
    raw: unknown[];
  }>;
}
```

- **Errors:** throw `ProviderError` with a code: `TIMEOUT`, `RATE_LIMITED`,
  `AUTH`, `HTTP_ERROR`, `INVALID_RESPONSE`, `NOT_CONFIGURED` or
  `PROVIDER_ERROR`. Throw `skip(message)` when the provider can't run for this
  input (e.g. no image).
- **Adding a source:** implement the interface. Fusion and the tests never
  depend on which provider ran.

## Environment variables

All of these are server-only. Never prefix them with `NEXT_PUBLIC_`.

| Variable                        | Default | Purpose                                                           |
| ------------------------------- | ------- | ----------------------------------------------------------------- |
| `SERPAPI_API_KEY`               | —       | Required for live search. Already declared in `.env.example`.     |
| `PRODUCT_SEARCH_COUNTRY`        | `us`    | Google `gl` market; sets the currency hint for ambiguous symbols. |
| `PRODUCT_SEARCH_LANGUAGE`       | `en`    | Google `hl`.                                                      |
| `PRODUCT_SEARCH_TIMEOUT_MS`     | `10000` | Per-provider timeout.                                             |
| `SERPAPI_MAX_REQUESTS_PER_HOUR` | `50`    | Local limiter; matches the free plan's hourly cap.                |

Only `SERPAPI_API_KEY` is in `.env.example` today. The `PRODUCT_SEARCH_*` and
`SERPAPI_MAX_REQUESTS_PER_HOUR` variables still need adding there, and that
file is shared, so the change needs agreeing first.

Without a key, each SerpApi provider records `NOT_CONFIGURED`. Nothing falls
back to mock data.

## Tests and the opt-in live run

`npm test` runs `tests/product-search/*.test.ts` against **real SerpApi
responses** recorded on 2026-10-10 in
`tests/product-search/fixtures/recorded/`:

- `dualsense-2026-10-10/`: the full query (brand + product + `CFI-ZCT2W`),
  plus Lens on a
  [public Wikimedia Commons DualSense photo](https://commons.wikimedia.org/wiki/File:Playstation_Dualsense_controller.jpg).
- `dualsense-no-model-2026-10-10/`: the same query without a model number.

Responses are trimmed by `tests/product-search/record.ts` to the fields the
adapters read. SerpApi's request metadata and account details are dropped.
Failure cases (an HTTP 500, a timeout) are injected around the recorded data;
no responses are invented. A request without a recording fails the test.
Global `fetch` is stubbed to throw, so any network access fails too.

What the recordings exercise:

- The exact model query finds `CFI-ZCT2W` listings.
- Lens mostly matches the **DualSense Edge**, a real conflict that's kept
  alongside the model-number results.
- Web search and Lens return the same Apple listing under two URL spellings,
  which are merged.
- Shopping and Lens return the same PlayStation offer, which is merged.
- Shopping also returns unrelated listings, flagged by
  `exactModelNumber: false`.

To refresh the recordings (about 6 searches):

```bash
PRODUCT_SEARCH_LIVE=1 PRODUCT_SEARCH_RECORD_DIR=tests/product-search/fixtures/recorded/dualsense-YYYY-MM-DD PRODUCT_SEARCH_IMAGE_URL=https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Playstation_Dualsense_controller.jpg/1280px-Playstation_Dualsense_controller.jpg SERPAPI_API_KEY=... npx vitest run tests/product-search/live.test.ts
```

Lens returned nothing for the full-size Commons original but worked with the
1280px thumbnail. Large images may silently produce empty Lens results.

The live check is skipped unless explicitly enabled. In Git Bash:

```bash
PRODUCT_SEARCH_LIVE=1 SERPAPI_API_KEY=... npx vitest run tests/product-search/live.test.ts
```

Optional settings:

- `PRODUCT_SEARCH_IMAGE_URL=https://…` also runs Lens.
- `PRODUCT_SEARCH_QUERY='{"brand":"Sony","product":"…"}'` overrides the
  development query.
- `PRODUCT_SEARCH_LIVE_OUT=search.json` writes the full result, including raw
  payloads, for inspection. It isn't trimmed, so don't commit it.
- `PRODUCT_SEARCH_RECORD_DIR=…` saves trimmed, replayable fixtures.

One run uses about 4–5 SerpApi searches, or one more with an image: 1–2 web
searches when the fallback is needed, 1 shopping search, 2 review searches and
1 Lens search.

## Lens and search-provider options

Google has no public Lens API, so every option scrapes Google results through a
third party. Prices were checked in October 2026; verify them before buying.

| Option                                                    | Lens?                                                                                    | Cost                                            | Limits                                                                          | Notes                                                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SerpApi](https://serpapi.com/pricing) (**implemented**)  | Yes, [`google_lens`](https://serpapi.com/google-lens-api) (`url` or uploaded `image_id`) | Free 250/mo; $25/1k, $75/5k, $150/15k per month | Free: 50/hour. Only successful searches billed; cached/failed free              | One key covers web, Shopping, Lens and reviews. Already named in `.env.example`. Shopping results may link to Google product pages rather than merchants. Offers a "U.S. Legal Shield" on paid plans. |
| [SearchApi.io](https://www.searchapi.io/docs/google-lens) | Yes, `google_lens` (public image `url`); visual matches include `price`/`currency`       | ~$40/10k per month and up                       | Per plan                                                                        | Similar coverage to SerpApi; cheaper per search at volume. Zero data retention is enterprise-only.                                                                                                    |
| Serper.dev                                                | Not confirmed from official docs                                                         | 2,500 free; ~$1/1k pay-as-you-go                | —                                                                               | Cheapest for plain web search; Lens availability unverified.                                                                                                                                          |
| DataForSEO / Oxylabs                                      | Yes (search-by-image / `google_lens`)                                                    | Pay-per-task / enterprise contracts             | —                                                                               | Heavier onboarding; better for bulk.                                                                                                                                                                  |
| Apify Lens actors                                         | Yes                                                                                      | ~$3–12.50 per 1k                                | Actor-dependent                                                                 | Community-maintained scrapers; reliability and ToS posture vary.                                                                                                                                      |
| Google Custom Search JSON API                             | No                                                                                       | 100/day free, $5/1k                             | Closed to new customers; shuts down 1 Jan 2027; new engines limited to 50 sites | Not viable.                                                                                                                                                                                           |
| Brave Search API                                          | No                                                                                       | ~$5 monthly credit (~1k searches), then $5/1k   | —                                                                               | Independent index (not Google). Terms restrict storing results.                                                                                                                                       |

Sources for the figures above: SerpApi's pricing and Lens docs, SearchApi.io's
Lens docs, and comparison posts from
[scrapingdog](https://www.scrapingdog.com/blog/searchapi-alternatives/),
[apiserpent](https://apiserpent.com/blog/serp-api-pricing-comparison),
[cloro](https://cloro.dev/blog/google-custom-search-api-shutdown/) and
[implicator.ai](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/).

**Terms-of-service trade-off.** Google's terms prohibit automated access to its
results. SERP APIs take on the scraping themselves and sell the results;
SerpApi offers legal indemnity ("U.S. Legal Shield") on paid plans.

**Recommendation.** Keep SerpApi as the first adapter: the repo already
anticipates it, and one key covers all four provider kinds. The free tier is
enough for development, at about 40 searches/day across 250/month.
SearchApi.io is the most direct alternative and could be added as a second
adapter behind the same interface. Adding any paid plan needs maintainer
approval.

**Image transport is still open.** Lens needs a publicly reachable image URL
(or SerpApi's upload `image_id`). Uploading user photos to a third party has
privacy implications and must be agreed before Lens runs on real images.
Until then the Lens provider is skipped when no `imageUrl` is supplied.

# Review Intelligence: source discovery

Given a product identity that's already known (brand, product name, optional
model number), this module finds review and discussion sources and returns
structured, provenance-carrying evidence for a later summarisation or
recommendation layer.

What it doesn't do:

- identify products,
- fetch or read pages,
- summarise reviews or score sentiment,
- call Gemini or any other LLM.

```ts
import { discoverReviewSources } from "@/lib/review-intelligence";
import { liveReviewProvider } from "@/lib/review-intelligence/config";

const result = await discoverReviewSources(
  {
    brand: "Sony",
    product: "DualSense Wireless Controller",
    modelNumber: "CFI-ZCT2W",
  },
  liveReviewProvider(),
);
// result.sources: strongest first. result.excluded: weak results, with reasons.
```

## Architecture

```
ReviewQueryInput
  -> buildReviewQueries     up to 6 queries, quoted model number first
  -> SearchProvider         Product Search's SerpApi review adapter, reused as-is
  -> mergeHits              dedupe per source, keep every discovery
       classifySource       reddit / professional_review / community / retailer_review / manufacturer / other
       assessRelevance      exact_model / product_name / product_family / weak
  -> sources + excluded + providerRun
```

**Reused from Product Search, without changes to it:**

- the `serpapi:google_reviews` adapter (via `liveProductSearchProviders`), which
  brings the API key, timeouts, the shared hourly allowance, row validation and
  safe error codes;
- `validateProviderOutput` and `safeProviderError`;
- URL canonicalisation;
- the model-number matcher (literal, normalised and extension observations);
- the token helper;
- the editorial review-site and manufacturer-domain lists.

**Owned here:** the query plan, source taxonomy, relevance rules, dedupe keys and
the output schema. Any `SearchProvider` with `kind: "reviews"` works, so another
vendor can be swapped in.

## Query strategy

| ID                | Example                                               | Only when         |
| ----------------- | ----------------------------------------------------- | ----------------- |
| `model-review`    | `"CFI-ZCT2W" review`                                  | model             |
| `model-reddit`    | `"CFI-ZCT2W" reddit`                                  | model             |
| `product-review`  | `Sony DualSense Wireless Controller review`           | product           |
| `product-reddit`  | `Sony DualSense Wireless Controller reddit`           | product           |
| `long-term`       | `Sony DualSense Wireless Controller long term review` | product           |
| `problems-reddit` | `Sony DualSense Wireless Controller problems reddit`  | product           |
| `model-problems`  | `"CFI-ZCT2W" Sony problems`                           | model, no product |

- **The model number is always quoted.** Unquoted, Google treated `CFI-ZCT2W` as
  "CFI" in a live run.
- **"reddit" is a keyword**, because `site:reddit.com` returned no Reddit
  results through SerpApi.
- **Cost:** one request per query, capped by `maxQueries` (default 6), with no
  retries or pagination. Only the first page of `organic_results` is read.

## Output (`types.ts`)

Each source has:

- `id`: `review_` plus a SHA-256 of the dedupe key, so it's stable across runs.
- `sourceType` and `classificationBasis`: how the type was decided.
- `title`, `url`, `domain` and `snippet`.
- `publishedText`: the provider's date text, as shown.
- `publishedDate`: `YYYY-MM-DD`, only for absolute dates. Relative text such as
  "3 months ago" is never converted.
- `reddit`: `{ subreddit, threadId }`, or null.
- `relevance`:
  - `level`,
  - `modelObservations`: where and how the model appeared,
  - `otherModelNumbers` and `siblingModelNumbers`,
  - `brandMatch`, `productTermsMatched` and `productTermsMissing`,
  - `familyTermsMatched`, `variantConflicts` and `accessoryCues`,
  - `notes`: why the level isn't higher.
- `discoveredBy[]`: provider, engine, query ID and text, request ID, result
  position, the original URL and `retrievedAt`.

The result also holds:

- `sources`, ranked by level, with ties kept in discovery order.
- `excluded`: weak results and retailer listings, with `exclusionReasons`.
- `queries`: the plan.
- `providerRun`: status, per-request records, discarded rows and a safe error.
- optional `raw`, with `includeRaw`.

## Relevance rules

These are decided from the title and snippet only.

| Level            | Rule                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact_model`    | The query model appears as written, or differs only in case, separators or spacing (`cfi-zct2w`, `WH 1000XM5`).                                                                                                     |
| `product_name`   | The product's family words appear (see below), at least half of all product words appear, and there's no sibling-product word or sibling model.                                                                     |
| `product_family` | The family words appear, but with a sibling word right after them (`DualSense Edge`), a sibling model (`CFI-ZCT1W`, `32GS95UE`), too few other product words, or only a longer form of the model (`27GP850-B.AUS`). |
| `weak`           | An accessory word appears in the title (`button set`, `case`, `charging station`, …), or the product doesn't appear at all.                                                                                         |

**What counts as the model:**

- These count as the model: `/` or `+` listing alternatives (`V2/CFI-ZCT2W`,
  `A2698+A2699`, `27GP850-B/27GP83B-B`) and a plural `s` (`WH-1000XM5s`).
- These don't: short suffixes (`CFI-ZCT2W/01`, `WH-1000XM5/B`) and regional
  codes (`.AUS`), which count only as `product_family`.

**Family words:**

- Family words are the product words that aren't generic category or feature
  words (`wireless`, `controller`, `gaming`, `noise`, `canceling`, …).
- Family words with a digit are required, since they name a generation or
  model: the `2` in AirPods Pro 2, or `1000xm5`.
- For the other family words, two-thirds is enough.
- Plurals and British spellings are folded (`controllers`, `cancelling`).

**Sibling models:**

- A sibling model is another model number shaped like the query model: the
  same kind and length of its first two letter/digit runs. `CFI-ZCT1W` matches
  `CFI-ZCT2W`, `32GS95UE` matches `27GP850-B`, and `WH-1000XM4` matches
  `WH-1000XM5`.
- Promo codes or board numbers (`PLAY5`, `BDM-060`) are recorded in
  `otherModelNumbers` but don't lower the level.

**No percentages or scores**, and no claim that a source discusses the exact
model without a matching observation.

## Source types

Rules are checked in this order:

| Type                  | Rule                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reddit`              | `reddit.com` or `redd.it`. Subreddit and thread ID come from the URL.                                                                                                     |
| `manufacturer`        | The brand's own domains (Product Search's list). This is spec or product evidence, **never an independent review**.                                                       |
| `community`           | Known forums, `forum.`/`community.`/`boards.` hosts, or `/forums/` and `/threads/` paths.                                                                                 |
| `retailer_review`     | A known retailer, with a reviews or Q&A path (`/site/questions/`) or "review"/"Questions & Answers" in the title. Other retailer pages are listings and go to `excluded`. |
| `professional_review` | A known review site (`known_review_site`), or an unlisted site with a `/review(s)/` path (`review_path`, the weaker basis).                                               |
| `other`               | Everything else, e.g. YouTube.                                                                                                                                            |

`manufacturer` is a sixth type, added to your list so brand pages are never
labelled as reviews.

## Deduplication

- **Same page only.** Sources merge only when they're the same page:
  - tracking parameters, `www.`/`old.` and a trailing slash or fragment are
    ignored;
  - Reddit threads merge on thread ID.
- **Similar titles never merge**: two different Reddit threads or articles stay
  separate.
- **Every discovery is kept** in `discoveredBy`, with its own original URL.

## Tests

`tests/review-intelligence/discovery.test.ts` uses zero API quota. It replays
real SerpApi responses:

- this module's own live runs of all six queries for four products in
  different categories (`tests/review-intelligence/fixtures/recorded/`);
- titles and URLs from Product Search's recordings.

Any request never recorded gets HTTP 500, so no data is invented. Malformed
cases are deliberate corruptions of a real response.

Results of the recorded live runs (2026-10-10):

| Product (model)             | exact_model | product_name | product_family | excluded |
| --------------------------- | ----------- | ------------ | -------------- | -------- |
| Sony DualSense (CFI-ZCT2W)  | 11          | 22           | 9              | 4        |
| Sony WH-1000XM5 headphones  | 43          | 0            | 0              | 3        |
| LG UltraGear (27GP850-B)    | 15          | 17           | 8              | 11       |
| Apple AirPods Pro 2 (A2698) | 9           | 27           | 0              | 8        |

Testing the other three products exposed rules tuned to DualSense, and those
rules were then generalised:

- Sibling models are now detected by model shape, not leading letters; LG
  models start with digits.
- Spaced model numbers now count.
- Required words are now limited to family words that contain a digit.
- A longer time budget fixed a run that was cut off.

Opt-in live run (up to 6 SerpApi searches; run only with maintainer approval):

```bash
REVIEW_INTELLIGENCE_LIVE=1 SERPAPI_API_KEY=... npx vitest run tests/review-intelligence/live.test.ts
```

Add `REVIEW_INTELLIGENCE_RECORD_DIR=tests/review-intelligence/fixtures/recorded/<name>`
to save trimmed responses. The replay helper picks them up automatically.
These live in their own folder, so they can't affect Product Search's
fixtures.

## Limitations

- Relevance reads only titles and snippets. A thread titled generically may
  still discuss the exact model.
- The variant-word and accessory-word lists are small and English-only.
- Dates stay as provider text unless absolute. Reddit results rarely carry one.
- Generic titles ("PS5 controller is on but completely unresponsive") stay
  `weak` even when they probably concern this product, because nothing in the
  result proves it.
- **Product-line names give line-level matches.** With "UltraGear Gaming
  Monitor", posts about other UltraGear monitors that don't name a model number
  are still `product_name`. Pass the most specific product name available.
- **Nicknames aren't known.** "XM5" for WH-1000XM5 and "pro2" written as one
  word stay `weak`.
- The recordings are one point in time. Search results drift, so refresh them
  with the record command when the tests need new cases.

# External product evidence discovery

Standalone server-only Search primitive; not wired into the application. Existing
live application search/verification endpoints remain unimplemented. This module
discovers source observations, not verified identity, final confidence or cheapest
offers. It does no OCR, embeddings, Gemini reasoning or evidence fusion.

## Input and output

```ts
const result = await runProductSearch(
  {
    brand: "Sony",
    product: "DualSense Wireless Controller",
    modelNumber: "CFI-ZCT2W",
    // sku, partNumber and variant are also optional.
    // Alternatively: identifiers: [{ kind: "model_number", value: "CFI-ZCT2W" }]
  },
  liveProductSearchProviders(),
  { includeReviews: false },
);
```

Import `runProductSearch` and module-local schemas/types from `./index`; import
`liveProductSearchProviders` from `./config`. No shared application contracts change.

Input preserves model/SKU/part-number kind and original identifier spelling.
`identifiers` supports explicit `caseSensitive`; models default to case-insensitive,
SKUs and part numbers to case-sensitive. At most eight identifier clues are allowed
across typed inputs and shorthands. Serial-number inputs are not supported. Variant
text narrows queries and remains a clue, not an established variant match.

Output is runtime validated and contains:

- `candidates`: opaque deterministic IDs, title, source URLs/domain, image URLs,
  typed identifier observations, brand/variant clues and per-source observations.
- `offers`: displayed and safely parsed current/list prices, currency, merchant,
  condition (`new`, `used`, `refurbished`, `open_box`, `unknown`), raw shipping/stock
  wording where supplied, and original observations.
- `providerRuns`: actual request records, executed query IDs, engine, timestamps,
  discarded-row counts, status (`ok`, `partial`, `error`, `skipped`) and safe errors.
- `queries`: planned queries, distinct from executed requests; optional sanitized
  debug `raw` data. Review sources are returned only with explicit `includeReviews`.

A `literal` identifier observation requires safe token boundaries and preserves
case policy. `CFI-ZCT2W-01`, `/01`, `_REV2`, `CFI-ZCT2WA`, `XCFI-ZCT2W` and
`CFI-ZCT2WPRO` are not literal matches. Separator/case folding, when observed, is
weaker `normalized` evidence; continuations may be `extension` observations.
Unrelated neighboring tokens are never joined to manufacture identifiers.
A mention in “Case for CFI-ZCT2W” or “Not compatible with CFI-ZCT2W” remains only a
mention. Legacy `exactModelNumber` means literal occurrence, not verified identity;
`modelNumbersSeen` contains untyped identifier-shaped tokens, not extracted facts.

Candidate IDs are SHA-256 of the conservatively canonicalized source URL, prefixed
`candidate_`. They identify source groups, not canonical products. Same-URL
conflicts remain in `observations`; the deterministic representative title and
aggregate signals must not be treated as a resolved identity. Image URLs are
retained when supplied and safe to expose; no image bytes are fetched.

Offers merge only when every material observed field agrees, allowing known
tracking URL differences and different request provenance. Every original
observation survives a merge. Different models, variants, conditions, merchants,
prices, currencies or meaningful URLs survive separately. Duplicate-looking
offers are preferable to lost evidence. No cross-condition comparison is claimed.

Prices with negatives, installments, bundles, ranges, mixed was/now wording or
unsupported decimal formats retain their display text with a null normalized
amount. Separate provider `old_price` may supply list price. Market currency hints
resolve bare `$`/`kr`; no currency conversion occurs. Shipping/tax/stock are not
fabricated, and discount tags are not stock information.

## Providers and limitations

SerpApi is a third-party service accessed via `https://serpapi.com/search.json`
using a server-side `api_key`. Parsers remain engine-specific:

- [`google`](https://serpapi.com/search-api): first-page `organic_results` only.
- [`google_shopping`](https://serpapi.com/google-shopping-api): shopping rows,
  product IDs, imagery and condition. A `product_link` is labeled
  `google_product_page`, not asserted to be merchant checkout.
- [`google_lens`](https://serpapi.com/google-lens-api): optional ordered image bytes or public image URL;
  uses `country`, preserves `exact_matches`/`visual_matches`/`organic_results`
  origin, images and boolean stock. Lens “exact” sections do not mean exact model
  evidence. No similarity score is invented.

Uploaded bytes use the direct Image API described below. An
explicitly supplied public image URL is transmitted to SerpApi; its query/fragment
are removed from returned references and a hash correlates the actual input.
Obvious local/private URLs are rejected, but DNS reachability is not verified.
Credential-bearing evidence/image URLs are omitted rather than exposed. Later
bounded acquisition must map candidate ID + image URL to bytes for local SigLIP.

Raw and normalized boundaries are validated. Bad individual rows are counted and
discarded; malformed top-level payloads fail. Successful empty responses stay
separate from failure. Earlier successful requests survive a later query failure
or provider timeout. Errors use fixed sanitized messages and typed codes:
`NOT_CONFIGURED`, `AUTH`, `TIMEOUT`, `RATE_LIMITED`, `HTTP_ERROR`,
`INVALID_RESPONSE`, `PROVIDER_ERROR` (plus `SKIPPED`). HTTP status classification
precedes JSON parsing. No failure falls back to demo data. No destination-page
crawling, retries, pagination or result cache is implemented. Source classification
uses a small domain allowlist, not brand substrings or authority scoring.

## Configuration and request cost

These module-local optional variables are documented here; shared `.env.example`
continues to declare `SERPAPI_API_KEY` only. Credentials must stay server-side.

| Variable                        | Default | Meaning                                             |
| ------------------------------- | ------- | --------------------------------------------------- |
| `SERPAPI_API_KEY`               | unset   | Required for live requests                          |
| `PRODUCT_SEARCH_COUNTRY`        | `us`    | Search/Shopping `gl`, Lens `country`; currency hint |
| `PRODUCT_SEARCH_LANGUAGE`       | `en`    | `hl`                                                |
| `PRODUCT_SEARCH_TIMEOUT_MS`     | `10000` | Whole-provider cascade timeout                      |
| `SERPAPI_MAX_REQUESTS_PER_HOUR` | `50`    | Process-local allowance per credential/endpoint     |

The allowance survives reconstructing adapters in the same process. It is not an
account-wide/distributed quota and resets on process restart; other processes and
external usage are not counted. Consult your actual plan before live calls.
No pricing, sustainable daily quota or legal conclusions are asserted here.

With the default four adapters, each textual engine makes one request per
identifier, plus at most one product-name fallback if fewer than three hits were
collected. All identifier queries execute unless a terminal error/time budget stops
them. Reviews add at most two Google requests only when opted in. Lens adds one
only with an image. Maximum: **21 requests** (eight identifiers + product fallback
for each of web/Shopping, two reviews, one Lens). Default Sony example: **at most
four**, or **five** with Lens; reviews are off. There are no automatic retries.

## Verification

Normal `npm test` consumes zero external quota. Tests comprise pure units,
handcrafted mocked HTTP/orchestration regressions, and supplied historical fixture
replays. Existing fixture metadata claims live recording on 2026-10-10; that origin
and historical observations have not been independently verified in this repair.
Older fixtures omit imagery; handcrafted Lens cases cover retained imagery.
Unexpected fixture/network requests fail the tests even if caught by the adapter.
Replay success proves local behavior on those payloads, not current live behavior.

The live smoke test is skipped unless `PRODUCT_SEARCH_LIVE=1`. It now requires
schema-valid useful evidence linked to at least one successful executed provider
request; all-provider failure or empty evidence fails honestly. **No live call was
run during this repair.** The proposed default acceptance uses Google Search and
Shopping for `"CFI-ZCT2W" Sony`, with at most one product fallback each (four
requests maximum); no Lens or reviews. Expect sourced literal identifier mentions,
candidates and, where supplied, imagery/offers. This does not prove association.

When explicitly authorized, run `PRODUCT_SEARCH_LIVE=1 npx vitest run
tests/product-search/live.test.ts`. Optional `PRODUCT_SEARCH_QUERY` overrides clues;
`PRODUCT_SEARCH_IMAGE_URL` enables Lens. `PRODUCT_SEARCH_LIVE_OUT` or
`PRODUCT_SEARCH_RECORD_DIR` writes sanitized output/trimmed fixtures only in that
opt-in run. Treat saved search text/URLs as potentially private. Exact billable
quota depends on the provider plan/cache/outcomes; budget up to one credit per
executed request, without relying on free or cached requests.

## Uploaded Lens discovery for general identification

Live evidence identification now supplies ordered `images` to `runProductSearch`
with only the existing visual provider. Each image is compressed below 500 KB,
uploaded directly to SerpApi `/image`, then searched with its short-lived `image_id`.
Public image URLs remain supported for existing callers. `sourceImageIndex` is
optional additive provenance on provider runs/references/observations. Credentials,
raw upload errors and usable upload IDs never enter results or debug payloads.
Uploads share the process request budget with Search/Lens. Malformed Lens rows
are discarded individually. No retry or review discovery is enabled by this path.
See [transport, quotas and smoke cases](../../identification/RUNTIME.md).

Lens rows remain candidates: they never derive exact identifier associations or
supply final identity. Semantic Fusion joins literal physical product wording to
source titles, resolving family/variant precision conservatively. Existing typed
identifier matching and Product Search offer/review normalization are unchanged.
SigLIP and candidate image acquisition remain deferred.

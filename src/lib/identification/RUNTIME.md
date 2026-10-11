# Identification runtime and manual validation

Default live evidence mode starts Lens upload/discovery alongside local PaddleOCR.
OCR identifiers retain the original exact Search → Association → Fusion path.
Without an identifier, literal OCR product wording supplies a bounded discovery
query. If no text query exists, one consistent Lens title may seed text Search.
Lens and Search source observations are aggregated by URL without dropping
provenance. Unconfirmed results may use one Gemini semantic call and, when no text
query was available, one semantic-name Search. Fusion alone decides status and
precision. No SigLIP, models, reviews or price adapters are added to the runtime.

## Development configuration

Use Node 24 and `npm ci`. Provision the existing Python 3.11 OCR environment and
cached PaddleOCR models as described in [vision-service](../../../vision-service/README.md).
Normal validation needs no Python/models/credentials or internet.

Set server-only values in the existing `.env.local`; never commit it:

```dotenv
USE_MOCK_SERVICES=false
IDENTIFICATION_MODE=evidence
OCR_PYTHON=/absolute/path/to/ocr-environment/bin/python
OCR_TIMEOUT_MS=60000
SERPAPI_API_KEY=your-key
# Optional fallback; leave blank to prove deterministic identification.
GEMINI_API_KEY=
GEMINI_VISION_MODEL=gemini-2.5-flash
PRODUCT_SEARCH_TIMEOUT_MS=10000
SERPAPI_MAX_REQUESTS_PER_HOUR=50
```

Restart `npm run dev`. Use the existing upload/camera UI, or:

```sh
curl --fail-with-body --silent --show-error \
  -F 'images=@/absolute/path/product.jpg;type=image/jpeg' \
  http://localhost:3000/api/identify
```

Submit all views together in order, up to four JPEG/PNG/WebP images, 3 MiB each,
4 MiB combined. Inspect `identificationStatus`, name, identifiers, `variant`,
`identityResolution`, `suggestedNextImage` and `meta.notice`.

Run only these bounded manual cases (each consumes external quota):

| Photo                                        | Evidence-supported expectation                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Front-only DualSense                         | Family when name/branding and sources agree; no invented CFI model             |
| Rear label CFI-ZCT2W, optionally front first | Confirmed exact model when OCR and independent exact association agree         |
| Diet Coke Caffeine Free front                | Named variant without model/SKU request; unreadable size may remain unresolved |
| Another ordinary packaged product            | Most specific physically and externally supported family/variant               |

Each image uses one SerpApi upload plus one Lens search, with no automatic retry.
Text Search runs web/Shopping queries under existing limits, reviews disabled.
With no model, a normal request plans two text requests plus two requests per
image (up to ten). Semantic fallback may add at most two name-search requests
when no OCR query was possible. Identifier requests retain the existing maximum
of eight clues per textual engine; up to four uploads add eight requests. The
shared process allowance counts uploads and searches. Actual account billing is
provider-defined. Stop after these cases; do not put live calls in `npm run check`.

## Image transport

[SerpApi Image API](https://serpapi.com/image-api) accepts multipart `image` plus
`api_key`, returning an `image_id` for immediate
[Lens search](https://serpapi.com/google-lens-api). IDs expire after ten minutes;
this is a provider ID expiry, not an application guarantee about vendor retention.
No public hosting or app upload storage is required. The server decodes static
images with a 40-million-pixel limit, applies orientation, strips metadata and
tries at most three JPEG resize/compression settings (1600/1200/800 px) until
under 500,000 bytes. Decode/output failures yield no candidate evidence. Provider
operations use the existing timeout, safe errors, row validation and shared quota.
Lens uses default search; discontinued product-only search is not requested.
Uploaded IDs/credentials/raw errors are absent from results and diagnostics.
Only hashed image references survive; source image indexes remain 1-based and
stable even when an image fails. Malformed result rows are discarded individually.

## Degradation and limits

- Lens unavailable: OCR + text Search + optional Gemini continue with safe notices.
- Gemini unavailable: deterministic OCR/Lens/Search still work; no fabricated fallback.
- OCR unavailable: Lens candidates and optional Gemini remain available. Lens alone
  is tentative; physically transcribed semantic packaging text plus independent
  source evidence may establish broad identity. If no component provides evidence,
  the existing safe OCR error is returned.
- Empty OCR is a successful extraction, distinct from provider failure. Missing
  product wording asks for a clear front/side label, not a universal model number.
  A transcribed model ambiguity can still request its model/SKU label. Conflicting
  variants retain family confirmation and an optional actionable variant photo.
- Source titles are observations, not crawled/verified destination pages. There is
  no alias ontology, aggressive fuzzy matching or guarantee that visual matches
  describe the photographed item. Unmatched wording remains tentative. Size is
  not resolved by this milestone. Full details are in [Fusion rules](README.md).
- Local OCR uses the existing private temporary files, no-shell CLI, timeout/output
  bounds and unconditional cleanup. The Node host needs the full checkout, Python,
  provisioned caches, filesystem and subprocess access. Missing cached weights can
  still trigger upstream downloads during a manual run; provision them first.
- `USE_MOCK_SERVICES=true` never enters live OCR/Lens/Search/Gemini. Explicit
  `IDENTIFICATION_MODE=gemini` retains legacy compatibility behavior.
- Shopping/review queries still require model numbers. This branch identifies
  general products but leaves downstream matching to those owners. The UI explains
  this limitation without downgrading confirmed general-product identity.
- SigLIP runtime/reranking, candidate image downloads and deployment remain deferred.

Development Search diagnostics remain bounded and sanitized, with no raw provider
errors, API keys, image bytes, upload IDs or source URLs. Full evidence URLs stay
in response provenance. No identification/image cache is introduced.

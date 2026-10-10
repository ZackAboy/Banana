# Architecture

Banana Lens is a stateless Next.js App Router application. The initial release
uses explicit demo providers by default. Live identification defaults to local
OCR + Product Search + deterministic Fusion, with optional Gemini fallback.
Unfinished shopping/review/verification adapters return typed errors. API credentials never
enter the browser bundle.

## Data flow and boundaries

```text
Upload / camera / additional images
  -> POST /api/identify (multipart validation)
  -> services/analysis -> local OCR CLI -> Product Search -> derived associations
  -> fuseProductEvidence -> ProductIdentification (optional Gemini if unconfirmed)
  -> uncertain/likely: request another image or verify a candidate
  -> confirmed: GET /api/prices and GET /api/reviews concurrently
  -> shared response schemas -> result dashboard and recommendation
```

Frontend consumes types inferred from `src/schemas` through `src/types` and
validated API responses. Route handlers only validate, call application services,
serialize, and translate errors. `src/lib/services` coordinates public provider
interfaces; workstreams do not import one another's internals.

## Shared contracts

`src/schemas/domain.ts` defines ProductIdentification, ProductCandidate,
ProductOffer, ReviewSource, ReviewInsights, and IdentificationStatus.
`src/schemas/api.ts` defines request/response/error envelopes, mode metadata,
product queries, and candidate selection. `src/types/index.ts` exports their
inferred TypeScript types. Nullable fields represent unavailable evidence.
The status is confirmed, likely, or uncertain; no numerical confidence score is
claimed to be a calibrated probability.

`src/lib/providers/interfaces.ts` is the shared integration boundary. Identification,
Lens, Shopping, review search, review analysis, and candidate verification have
separate interfaces. `src/lib/providers/index.ts` chooses mock or live providers
once per operation from server configuration. It never catches a live error and
substitutes mock data.

## Current runtime integration

`src/lib/identification/runtime.ts` orchestrates existing public evidence contracts.
`local-ocr.ts` invokes `python -m app.services.ocr_cli` with bounded ordered private
temporary files, timeout, output limit, no shell and unconditional cleanup. Strong
OCR identifiers become typed Search inputs; serials are excluded. Search results
flow through the existing association adapter and deterministic Fusion. Exact
physical/external agreement can confirm without Gemini or visual retrieval.
Failed components provide no fabricated evidence. Existing response metadata
carries safe availability notices; Fusion supplies status, reasoning and photo
follow-up. The UI does not substitute a label request for a null photo suggestion.

`USE_MOCK_SERVICES=true` remains the deterministic synthetic default.
`IDENTIFICATION_MODE=evidence` is the live default; `gemini` explicitly selects
legacy compatibility. See [runtime setup](src/lib/identification/RUNTIME.md) for
configuration/manual validation. No Python HTTP server or SigLIP wiring is added.

## Legacy identification and verification

The following Gemini-only behavior applies to `IDENTIFICATION_MODE=gemini`.

Milestone 1 is Gemini multimodal reasoning across all submitted images ->
structured identification and evidence -> Zod validation -> the existing
`/api/identify` response. `src/lib/ai/identification.ts` implements the provider
using `models.generateContent` from the installed official SDK, inline image
bytes, a server-only instruction module, and `responseJsonSchema` generated from
Zod. It makes one request across all views with no automatic retries. It does
not perform Lens, Shopping, candidate verification, or review calls.

The private model response contains the shared identification plus an evidence
assessment. The server checks model/SKU/unique-label/packaging clues against
transcribed text, or requires multiple distinct model-identifying visual clues
with interpretations. Unsupported confirmation is downgraded to likely when a
family is supported, otherwise uncertain. Conflicting images are uncertain.
Cautious statuses are currently never upgraded; numeric confidence is unused. Missing
follow-up instructions for likely/uncertain receive a model-label photo request.
Candidates remain empty because no independent candidate search has run. The
public identification/status/type/provider contracts are unchanged. Perception
and whether visual clues exclude lookalikes still depend on Gemini; validation
checks structure and evidence consistency, not independent visual truth.

Future milestones may add Lens candidates and identity/model/variant verification.
`src/lib/search/lens.ts` and `src/lib/products/verification.ts` are Product Search
search/verification extension points. Shared Gemini initialization is in `src/lib/ai/client.ts`.
The SDK client is created only for a live identification operation.

All images contributing to the current identity are resubmitted together. No
session database or permanent upload storage is used. Image counts, MIME types,
sizes, and file signatures are checked on the server and UX limits on the client.
The client releases preview URLs on removal/reset/unmount. Image analysis is
not cached or logged. Lens requires a reachable image URL; the Product Search owner
must agree on a temporary, privacy-conscious transport before enabling it.

The deterministic demo ignores image content. In the confirm scenario one image
returns a confirmed LG 27GP850-B. In the follow-up scenario one image returns a
likely monitor with no model; a second image returns confirmation. Demo evidence,
offers, and review insights are explicitly labeled synthetic. Candidate choice
is an explicit user assertion in demo mode, not automatic visual proof.

## Prices and review intelligence

Prices and reviews are only fetched after confirmed identity, using brand,
model number, product name, and variant queries. Independent requests run in
parallel and display independent failure/retry states. Candidate selection uses
POST /api/products/verify before enabling these requests.

Live Shopping must verify exact model and variant, normalize currencies, and
separate new, used, refurbished, and unknown conditions before price ordering.
Never compare different currencies as if they are interchangeable. Unknown
prices remain null. `src/lib/products/normalization.ts` supplies normalized query
keys; `offers.ts` provides condition/currency grouping and safe price sorting.

Review Search retrieves source links/snippets; Review Analysis consumes evidence
through its interface and must separate source statements from interpretation.
No invented opinions, statistics, or citations. Empty evidence produces a clear
insufficiency state. Both live review modules are deferred `TODO(Reviews)` maintainer work.

## Cache and API efficiency

`src/lib/cache/memory.ts` supplies a bounded TTL request/result cache with
in-flight deduplication and normalized keys including product variant and mode.
Only price/review requests are cached; failures are not cached. This cache is
best effort per process and may reset or differ between Vercel instances. It
requires no Redis, database, or background workers and is not durable storage.

## Configuration and errors

`src/lib/config/env.ts` validates server-only live/mock, identification mode,
OCR executable/timeout and Gemini settings. Mock is the default. Evidence mode
uses local OCR and external Search with optional Gemini; explicit legacy Gemini
mode requires its key and model. Component availability is surfaced through safe
notices or errors, never synthetic fallback. Unfinished adapters report 501.
Errors use `{ error: { code, message } }`; private provider exceptions are not
sent to clients. API responses are no-store. Temporary OCR inputs are removed
after execution; images and identification are not cached.

Missing/inaccessible Gemini configuration returns 503, rate limits return 429,
and request failures or invalid/blocked/truncated output return safe 502 errors.
The SDK uses a 60-second request timeout. Gemini diagnostics log only fixed error
codes. Development-only Search diagnostics additionally include bounded, sanitized
query and source-text summaries plus request/association outcomes. They omit source
URLs, configured API keys and raw provider errors; production disables this logging.
Neither diagnostic path logs image bytes or Gemini response text.

## Independent evidence architecture

Target flow (OCR + Search + Fusion is active; retrieval remains deferred):

```text
Product images (same ordered views)
  +-> OCR: text and identifiers ---------------------+
  +-> Visual retrieval: candidate similarity --------+-> Evidence fusion
  +-> Gemini: semantic hypotheses/observations ------+      |
                                                           v
                                                     Product candidates
                                                           |
                                         External verification/search/Lens/data
                                                           |
                                                     Final identity
                                                           |
                                                     Prices / reviews
```

Gemini is one evidence source, not the final authority over other sources.
OCR and embeddings must run independently of Gemini. Search/Lens discovers or
verifies candidates rather than replacing the whole pipeline. YOLO is deferred.

`src/schemas/evidence.ts` extracts the existing image-indexed semantic assessment
without changing Gemini's JSON output shape. `SemanticVisionEvidence` plus the
existing `ProductIdentification` proposal supply brand, category, family/features,
visible text and image references without a duplicate semantic domain model.
`src/lib/identification/fusion.ts` accepts the source-tagged semantic signal and
returns a cloned, adjudicated `ProductIdentification`. Parsing/schema validation
and checking image references remain in the Gemini adapter; status policy is
separate from JSON/SDK handling. The first implementation deliberately preserves
the old policy. There are no numerical weights, new external calls, inferred
probabilities, automatic retries, or changes to mock mode.

Future sources are documented design targets, not unused runtime schemas or
placeholder providers. Extend the fusion input through a coordinated shared
contract change when a source can produce real evidence. Keep these requirements:

| Source                | Required evidence and reuse                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR                   | Per-image raw and normalized text; detected identifiers with kind (model/SKU/part/other), literal observation/span, source image index and extraction provenance; brand clues. Retain raw text rather than only normalized guesses. Label role (manufacturer/product/packaging/unknown) and how it was established must be explicit; do not present inferred identifiers as extracted. |
| Semantic vision       | Reuse the current proposal's category, brand/product-family hypotheses and distinguishing features plus the image-indexed semantic assessment. Identify Gemini as the source; observations and interpretation remain separate.                                                                                                                                                         |
| Retrieval             | Reuse `ProductCandidate` for identity/name/source/URL; attach provider/model/index provenance, candidate image URL where available, source image indexes and the native similarity metric/score. A similarity score is not identity probability. Do not put embeddings or scores into UI confidence.                                                                                   |
| External verification | Reuse `ProductCandidate` identity, source, source URL, evidence and match reason; add explicit supported/contradicted/unresolved findings for model/variant and the candidate reference. Retrieved evidence is separate from interpretation.                                                                                                                                           |

Image indexes are 1-based within the current request, matching Gemini. Resubmit
all views together; indexes are not persistent IDs. Future inference transport
must preserve that order. The Python schemas and Next.js validators should share
versioned fixtures/contract tests before a backend client is wired. Do not use
empty evidence as proof that a provider ran successfully. Provider errors remain
explicit, never synthetic evidence. Only fusion should decide the final status;
source adapters must not independently confirm the final product.

## Python service decision

Python owns local OCR and retrieval dependencies. FastAPI still exposes only
health; Node invokes the existing OCR CLI rather than adding HTTP inference.
Pinned OCR dependencies and cached models are separately provisioned. The bridge
uses versioned JSON, bounded private temporary files and process limits. Health
does not establish model readiness. Deployment packaging and SigLIP runtime
transport remain deferred; see the runtime guide above.

## Historical Gemini-only CFI-ZCT2W confirmation issue

In explicit legacy Gemini-only mode, the observed Sony DualSense case remains reproducible: `MODEL CFI-ZCT2W` matches the
proposed model, but an original `likely` status is never upgraded by the current
policy. Missing next-image instructions then default to another model-label photo.
This is a policy limitation, not frontend drift. The regression in
`tests/gemini.test.ts` records this current behavior and the conflict veto.

A robust upgrade requires a complete identifier actually extracted from a
product/manufacturer label, matching the proposed model/SKU/part number, consistent
brand/product/variant evidence, and no contradictory signals. Current `visibleText`
and `exactMatch` are both Gemini-authored; they do not independently establish
label provenance, extraction versus inference, or cross-source consistency.
Changing `likely` to `confirmed` just because these fields agree would disguise
that gap. No temporary upgrade heuristic or model-confidence threshold is added.
The independent Fusion tests cover CFI-ZCT2W positive confirmation, inferred-only identifiers,
partial identifiers, mismatched brands/variants, invalid image references and
conflicts. After confirmation, remove the redundant label request. Part-number
support can remain internal until a necessary UI contract change is agreed.

## Workstreams

See AGENTS.md and CONTRIBUTING.md. New branches are `feature/vision-ocr`,
`feature/visual-retrieval`, and `feature/product-search`. OCR owns text extraction;
retrieval owns embeddings/similarity; Product Search owns external candidates,
verification and later shopping. Shared fusion/Gemini/orchestration/UI/reviews
remain maintainer-coordinated. Runtime Fusion work uses `feature/evidence-fusion`; YOLO is deferred.

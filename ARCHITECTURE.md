# Architecture

Banana Lens is a stateless Next.js App Router application. The initial release
uses explicit demo providers by default. Live identification uses Gemini;
other live adapters return a typed not-implemented error. API credentials never
enter the browser bundle.

## Data flow and boundaries

```text
Upload / camera / additional images
  -> POST /api/identify (multipart validation)
  -> IdentificationProvider -> ProductIdentification
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

## Identification and verification

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
Cautious statuses are never upgraded; numeric confidence is unused. Missing
follow-up instructions for likely/uncertain receive a model-label photo request.
Candidates remain empty because no independent candidate search has run. The
public identification/status/type/provider contracts are unchanged. Perception
and whether visual clues exclude lookalikes still depend on Gemini; validation
checks structure and evidence consistency, not independent visual truth.

Future milestones may add Lens candidates and identity/model/variant verification.
`src/lib/search/lens.ts` and `src/lib/products/verification.ts` are Architecture
search/verification extension points. Shared Gemini initialization is in `src/lib/ai/client.ts`.
The SDK client is created only for a live identification operation.

All images contributing to the current identity are resubmitted together. No
session database or permanent upload storage is used. Image counts, MIME types,
sizes, and file signatures are checked on the server and UX limits on the client.
The client releases preview URLs on removal/reset/unmount. Image analysis is
not cached or logged. Lens requires a reachable image URL; the Architecture owner
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
insufficiency state. Both live review modules are TODOs for Architecture.

## Cache and API efficiency

`src/lib/cache/memory.ts` supplies a bounded TTL request/result cache with
in-flight deduplication and normalized keys including product variant and mode.
Only price/review requests are cached; failures are not cached. This cache is
best effort per process and may reset or differ between Vercel instances. It
requires no Redis, database, or background workers and is not durable storage.

## Configuration and errors

`src/lib/config/env.ts` is server-only, validates USE_MOCK_SERVICES and centrally
holds Gemini model selection. Mock is the default without credentials. Explicit
live mode requires GEMINI_API_KEY and GEMINI_VISION_MODEL; SerpApi credentials
and the text model remain optional for this milestone. Unfinished adapters still
report 501. Neither missing credentials nor provider failures
trigger fallback. Errors use `{ error: { code, message } }`; private provider
exceptions are not sent to clients. API responses are no-store; cache policy is
owned by application services. No user images or secrets are persisted.
Missing/inaccessible Gemini configuration returns 503, rate limits return 429,
and request failures or invalid/blocked/truncated output return safe 502 errors.
The SDK uses a 60-second request timeout. Diagnostics log only fixed error codes,
never credentials, image bytes, model response text, or provider exception text.

## Workstreams

Follow AGENTS.md. `feature/architecture` owns identification/Gemini, multi-image
reasoning/uncertainty, Lens/Shopping, verification/offers, review evidence and
recommendations, caching/providers/orchestration/APIs, and backend/unit/integration
tests. `feature/ui` owns components/pages, upload/camera and multi-image UX,
dashboard and uncertainty presentation, accessibility/interactions/theme, and
frontend/browser tests. UI uses existing mocks and does not implement external
integrations; Architecture avoids presentation changes unless required for a
shared contract. Provider interfaces, schemas, configuration and API contracts
remain shared. Keep adapters behind existing interfaces so mock mode stays usable.

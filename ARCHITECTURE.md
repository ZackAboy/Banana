# Architecture

Banana Lens is a stateless Next.js App Router application. The initial release
uses explicit demo providers; live adapters intentionally return a typed
not-implemented error. API credentials never enter the browser bundle.

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

The intended live pipeline is Gemini multimodal reasoning across all submitted
images -> hypothesis, OCR and distinguishing features -> Lens candidates ->
identity/model/variant verification -> confirmed result or a useful follow-up
image request. `src/lib/ai/identification.ts` is the Vision extension point.
`src/lib/search/lens.ts` and `src/lib/products/verification.ts` are Shopping
extension points. Shared Gemini initialization is in `src/lib/ai/client.ts`.
The initial setup creates the SDK client lazily but makes no live model calls.

All images contributing to the current identity are resubmitted together. No
session database or permanent upload storage is used. Image counts, MIME types,
sizes, and file signatures are checked on the server and UX limits on the client.
The client releases preview URLs on removal/reset/unmount. Image analysis is
not cached or logged. Lens requires a reachable image URL; the Shopping owner
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
insufficiency state. Both live review modules are TODOs for Reviews.

## Cache and API efficiency

`src/lib/cache/memory.ts` supplies a bounded TTL request/result cache with
in-flight deduplication and normalized keys including product variant and mode.
Only price/review requests are cached; failures are not cached. This cache is
best effort per process and may reset or differ between Vercel instances. It
requires no Redis, database, or background workers and is not durable storage.

## Configuration and errors

`src/lib/config/env.ts` is server-only, validates USE_MOCK_SERVICES and centrally
holds Gemini model selection. Mock is the default without credentials. Explicit
live mode requires both API keys and model names, and still reports 501 until
adapters are implemented. Neither missing credentials nor provider failures
trigger fallback. Errors use `{ error: { code, message } }`; private provider
exceptions are not sent to clients. API responses are no-store; cache policy is
owned by application services. No user images or secrets are persisted.

## Workstreams

Follow AGENTS.md. Frontend owns components/pages; Vision owns identification and
the Gemini client; Shopping owns Lens, Shopping, candidate verification and
normalization; Reviews owns source discovery, analysis and recommendations.
Provider interfaces, schemas, configuration and API contracts are shared.
Keep adapters behind the existing interfaces so mock mode remains usable.

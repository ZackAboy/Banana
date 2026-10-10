# Local identification runtime

Live `/api/identify` defaults to ordered uploaded bytes → existing PaddleOCR CLI
→ typed Product Search query → `deriveSearchAssociations` inside `adaptEvidence`
→ `fuseProductEvidence` → `toProductIdentification` → existing API and UI.
No Gemini call is needed for exact independent confirmation. No SigLIP, image
download, destination crawling, new provider, price or review integration is added.

## Configuration and first real front + rear test

1. Use the supported Node version from `.nvmrc` and the installed npm dependencies.
   Have a separate CPython 3.11 OCR environment provisioned according to
   [vision-service instructions](../../../vision-service/README.md). Its pinned
   PaddleOCR/PaddleX dependencies and both official model caches must already be
   available: `PP-OCRv5_mobile_det` and `en_PP-OCRv5_mobile_rec`. Offline validation
   uses mocked processes/providers and requires no model installation or download.
2. Edit the existing `.env.local` (copy `.env.example` only if it does not exist):

   ```dotenv
   USE_MOCK_SERVICES=false
   IDENTIFICATION_MODE=evidence
   OCR_PYTHON=/absolute/path/to/your/ocr-environment/bin/python
   OCR_TIMEOUT_MS=60000
   SERPAPI_API_KEY=your-real-key
   GEMINI_API_KEY=
   ```

   Clearing Gemini's key proves it is unnecessary. Never commit credentials.
   Existing `PRODUCT_SEARCH_*` configuration and process rate limits still apply.

3. Start/restart `npm run dev` from the repository root. Upload the controller
   front first, readable upright rear label second, using the existing UI.
   Alternatively inspect the API directly:

   ```sh
   curl --fail-with-body --silent --show-error \
     -F 'images=@/absolute/path/front.jpg;type=image/jpeg' \
     -F 'images=@/absolute/path/rear-label.jpg;type=image/jpeg' \
     http://localhost:3000/api/identify
   ```

   This consumes live SerpApi quota. Limits: 1–4 JPEG/PNG/WebP images, 3 MiB
   each, 4 MiB combined, matching the existing upload and Python service limits.

4. Inspect `identificationStatus`, `modelNumber`, `productName`, `reasoning`,
   `suggestedNextImage` and `meta`. With explicit OCR `MODEL CFI-ZCT1W`, a
   qualifying independent direct-title source, and no conflict, expect
   `confirmed`, the external product name, `CFI-ZCT1W`, and null next-image
   suggestion. The same rules apply to CFI-ZCT2W and unrelated identifiers.
   The UI shows Confirmed without another label request. It may then display
   separate 501 errors for still-unimplemented shopping/review adapters.
5. If unconfirmed, inspect OCR separately using the existing CLI with both images
   in the same order, then inspect Search evidence through its existing public
   interface if needed. A read label with insufficient external association has
   no photo request; its reason identifies missing external association.
   Do not interpret an unsuccessful live listing match as proof of identity.

## Process and failure boundaries

The Node-only bridge requires an explicit absolute `OCR_PYTHON`. It uses
`execFile` without a shell, fixed module arguments and the repository's
`vision-service` working directory. Request images are written in order to a
private OS temporary directory with 0600 files, then deleted in `finally` on
success, process failure, timeout or invalid output. Python's existing image
decoder additionally enforces static images and pixel limits. Execution is
bounded by `OCR_TIMEOUT_MS` (1000–180000 ms), SIGKILL and a 4 MiB output limit.
Versioned JSON, ordered image indexes and grounded spans are validated.

`DISABLE_MODEL_SOURCE_CHECK=True` avoids PaddleX's connectivity check with
provisioned caches; it **does not prevent the upstream loader downloading absent
weights**. Provision caches before the manual test. Inference is local and images
are never uploaded to OCR. Each request starts a fresh Python/model process;
there is no permanent server, warm pool or deployment infrastructure.

Successful OCR with no strong identifier is valid negative extraction evidence.
An unavailable process, timeout, invalid response or failed inference contributes
no physical evidence. Invalid image input remains a 400 error. Search is called
only for explicit nonserial identifiers, preserving kinds and spelling, and only
with a unique observed brand clue. Ambiguous brands are omitted from the query;
all original OCR claims remain in Fusion. Search's input bounds are respected;
an oversized set is not silently truncated. Search errors/partial runs are
recorded in existing safe `meta.notice`; returned evidence retains provenance.

If unconfirmed and both Gemini key/model are configured, the existing single-call
semantic adapter returns its original image-indexed evidence to Fusion. Gemini
can supply a tentative family or conflict; its status/label transcription cannot
confirm independently. Its photo request is ignored in favor of Fusion's
follow-up. If OCR is unavailable and Gemini also cannot run, the route returns
a safe OCR error through the existing envelope. If OCR succeeded and fallback
fails, the route returns the deterministic result with a notice. Live never
substitutes mocks. `USE_MOCK_SERVICES=true` invokes only existing deterministic
demo providers; `IDENTIFICATION_MODE=gemini` preserves explicit legacy behavior.

## Remaining limits and ownership

- This requires the full checkout on a Node host with local Python/subprocess
  and temporary-filesystem access. Standalone/serverless packaging is not wired.
  A health endpoint does not establish OCR readiness. Host shutdown may interrupt
  cleanup; ordinary execution exits clean up temporary resources.
- Source association remains deliberately narrow: grounded brand-prefix product
  title with an exact typed identifier suffix, or consistent strongly labeled
  specifications, and no relationship/negation/source-group conflict. See the
  [association rules](README.md). Real titles/snippets can fail those patterns.
  No source is invented.
  Search identifier observations are query-specific, so an unqueried alternate
  model mentioned in a title may remain unresolved rather than become a typed
  conflict; it still cannot establish matching exact association.
- Manufacturer/brand names use the bounded corporate-name relationship described
  in the association rules; explicit physical brands still require exact agreement.
  This is lexical grounding, not ownership verification. Inconsistent OCR,
  differently named qualifying identities or unsupported source patterns may
  still block confirmation.
- Public identification/API/provider schemas are unchanged. Full conflicts,
  reason codes, provenance and part number remain available in the internal
  runtime Fusion result; the current API projects status, identity, reasoning,
  photo suggestion and availability notice. **Fusion maintainers** own any future
  additive diagnostic API. No evidence/image contents are logged by this bridge.
- **Product Search + Visual Retrieval** own the deferred bounded candidate-image
  acquisition → SigLIP interface. Runtime visual inference remains absent.

Offline tests exercise the real Search normalization, association rules, Fusion,
API projection, UI follow-up and bridge cleanup with injected processes/providers.
They do not establish real OCR accuracy, cached-model readiness, source availability
or actual DualSense identification. Separately, the developer verified the real
CFI-ZCT2W rear-label image through the UI with Gemini disabled: Confirmed, Sony,
Sony PlayStation Dual Sense Wireless Controller, model CFI-ZCT2W, with no repeated
label-photo request. Exact confirmation still requires qualifying independent
external evidence on each request.

## Development Search diagnosis

`npm run dev` emits one bounded JSON line beginning `[identification:search]`
after each identification that planned Search. It includes typed query input,
planned query classes, provider/request IDs and engines, executed/status/error
codes, discarded-row counts, candidate and association counts, sampled source
titles/snippets/domains/identifier observations, existing-rule rejection reasons
and final Fusion reason codes. Arrays and strings are bounded; full counts remain.
No raw provider error/body, source URLs or configured API keys are logged. Logging
is disabled outside development and does not change evidence or decisions.
There is no new public API/debug endpoint or additional provider request.

The first real OCR upload extracted `MODEL CFI-ZCT2W` and manufacturer
`Sony Interactive Entertainment Inc.`. The generated Search input is that
manufacturer string as `brand`, plus typed model identifier `CFI-ZCT2W`; the sole
planned product query is `"CFI-ZCT2W" Sony Interactive Entertainment Inc.`.
Runtime web/shopping providers can each execute that query; Lens/reviews skip.

Before the association fix, a single bounded Google web replay on 2026-10-10
returned HTTP 200, provider
Success, nine candidates, zero discarded rows, and exact identifier occurrences.
Domains were Best Buy (3), eBay (2), Pawn America (3), and PayMore (1). All source
brand clues were null: the web response supplied no structured brand, and Search's
fallback only recognizes the full query brand when all its tokens appear in
returned text. These sources used the shorter `Sony`. Association's required
source-brand check then rejected all nine observations. Some additionally contain
guarded wording; the identifier-suffix eBay title has `get the best deals for`
in its snippet, which triggered the former broad relationship guard.
Other titles have the identifier only in snippets or inside a truncated title.
That replay had no accepted association and therefore no Fusion brand-conflict
check between manufacturer and external brand. Multiple unassociated
candidates leave product name unresolved and status uncertain, without another
label-photo request.

This diagnoses an evidence/association boundary gap, not a failed web request in
the replay. The original UI's incomplete-provider notice cannot be attributed
to a particular provider/error because its internal result was not retained;
the single replay did not call shopping. Rerun the same image in development
and inspect that line to establish every provider's outcome. The generic fix now
allows literal source-title/labeled-field brand grounding, a bounded corporate-name
relationship, and field-scoped snippet guards. The captured subject-bearing title
qualifies without structured brand metadata; retailer boilerplate does not veto it.
MPN remains a part number rather than model-number evidence. No product-specific
alias, arbitrary first-title-token inference or literal-occurrence-only association
was introduced. Failed/partial requests remain visible without vetoing otherwise
valid confirmation; intentional optional skips are recorded without a failure reason.

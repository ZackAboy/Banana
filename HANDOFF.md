# Multi-model architecture baseline handoff

## Starting point and merge audit

The working tree was clean on arrival. Local `main` was fast-forwarded, without
resetting or discarding work, to `758a137447e07a647787d40a10204521a9565afa` after
fetching/pruning origin. Git history records Architecture PR #2 at `b79f96b` and
the latest UI PR #3 at `758a137` (plus earlier UI PR #1 at `edcd967`). Both remote
feature tips, and both old local tips, are ancestors of updated main with no unique
unmerged commits. The merged scanner UI and live Gemini implementation are present.

The baseline commit is the commit containing this handoff; obtain its full hash
with `git log -1 --format=%H -- HANDOFF.md`. The task's final report records the
exact hash and branch pointers after local housekeeping. No remote writes are
part of this baseline.

## Audit findings and changes

Reviewed UI/upload/camera, all-view resubmission, multipart bounds/signatures,
identify route/service/provider selection, Gemini SDK/configuration/structured
output, mocks, domain/API schemas, status/evidence policy and result rendering.
Also reviewed price/review boundaries, cache/error handling and documentation.

- No conflict markers, frontend/backend response-shape drift, or credential-pattern
  matches were found in tracked application/configuration/test/documentation files.
  Existing local environment files remain ignored and untouched. Checks are not a
  guarantee that arbitrary secrets cannot exist.
- Mock behavior is intentionally isolated in fixtures/providers. Live failures
  stay typed errors; there is no fallback to synthetic success. Image limits and
  1-based source references remain enforced. No new external operation is enabled.
- Gemini parsing previously owned status adjudication. Extracted the same semantic
  evidence schema into a reusable shared module and moved policy to a source-tagged
  fusion boundary. It clones the proposal; it adds no score formula or source.
- Fixed a camera lifecycle race: a delayed permission response after unmount/scan
  could leave a camera stream running. Stale requests now stop their tracks and
  cannot replace current camera state. Added an HTTP/browser lifecycle regression.
- Replaced stale two-workstream assignments and initial-only handoff claims;
  corrected README demo controls, preserved historical UI design notes, and
  reassigned search/verification TODOs to Product Search. No broad styling refactor.
- No speculative file deletion: remaining live adapter stubs and UI primitives
  are intentional extension points, not merge artifacts.

## Architecture and shared contracts

Gemini remains one semantic source. Independent OCR and retrieval signals will
feed fusion, then candidates and external verification, then final identity and
prices/reviews. Lens is a candidate/verification source, not the whole pipeline.
YOLO is deferred. No dedicated fusion branch is required yet.

Added `semanticVisionEvidenceSchema` in `src/schemas/evidence.ts`, the inferred
`SemanticVisionEvidence` type, and the internal `SemanticVisionSignal`/`fuseEvidence`
boundary in `src/lib/identification/fusion.ts`. The existing Gemini evidence shape
is reused rather than duplicated. **UI-facing ProductIdentification, API envelopes,
existing provider interfaces, environment settings and Gemini JSON shape are
unchanged.** Future OCR/retrieval/verification representations are documented in
ARCHITECTURE.md; no unused runtime schemas or no-op providers were introduced.

Added an independent, optional FastAPI service with only `GET /health`, minimal
runtime dependencies (FastAPI/plain Uvicorn), separate future service/model/schema
packages and development checks. Python isolates native ML dependency/model
lifecycles from Next.js functions. No PaddleOCR, torch, Transformers, SigLIP/CLIP,
Ultralytics, inference code, model weights/downloads, service client, new env setting
or deployment was added. Python is not needed to run the existing application.
See vision-service/README.md for independent startup and validation.

## CFI-ZCT2W diagnosis and deferred resolution

Reproduced the Sony DualSense case with a structured two-image fixture: the exact
model is retained, but `likely` is never upgraded by the existing adjudication
policy. A missing follow-up request becomes another model/SKU label request.
This is backend policy, not a display mismatch.

The current transcription and exact-match assessment are both Gemini-generated;
there is no independent manufacturer-label provenance, extraction/inference
classification, or cross-source brand/variant consistency assessment. A temporary
agreement-based upgrade would conceal this limitation. The baseline preserves
current behavior and adds a regression documenting it, including conflict veto.
Future fusion must accept complete, source-supported label identifiers, check
model/SKU/part and brand/product consistency, veto conflicts, and clear redundant
label requests after confirmation. Numeric model confidence is never sufficient.

## Validation

Used Node 24.21.0 (the host default is unsupported Node 23) and Python 3.14.5.

| Check                         | Result                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm test`                    | 66 tests passed across 6 files                                                                            |
| `npm run typecheck`           | Passed after correcting a new test-fixture type mismatch                                                  |
| `npm run lint`                | Passed                                                                                                    |
| `npm run build`               | Passed, production webpack build; mock mode explicitly enabled                                            |
| `npm run test:e2e`            | 6 Chromium tests passed against a fresh production server                                                 |
| `npm run format:check`        | Passed                                                                                                    |
| `git diff --check`            | Passed (working tree and staged baseline)                                                                 |
| Python editable install       | Passed in ignored project-local virtualenv                                                                |
| Python pytest                 | 2 passed; upstream Starlette warning about deprecated httpx TestClient support                            |
| Python Ruff lint/format       | Passed                                                                                                    |
| Python dependency consistency | `pip check` passed                                                                                        |
| Python standalone startup     | Uvicorn started; HTTP `/health` returned 200 and `{"status":"ok"}`; server stopped                        |
| Python static typecheck       | Not configured; not run                                                                                   |
| `npm audit --omit=dev`        | Zero vulnerabilities                                                                                      |
| Full `npm audit`              | Five existing high findings in the Next lint dependency chain (`braces`); no dependency rewrite attempted |

The first browser attempt could not launch because the required Chromium binary
was absent. Installed the matching Playwright Chromium, FFmpeg and headless shell,
then reran. No application behavior had executed in that first attempt. Live
Gemini network calls, physical camera hardware and deployment were not tested;
Gemini/HTTP live-mode tests mock the SDK and consume no quota.

## Ownership, assumptions and integration order

1. Start all three local branches at the final validated main baseline; use separate
   worktrees for concurrent development. Do not switch this checkout underneath a
   developer or independently redesign shared service files.
2. OCR owns text/identifier extraction and normalization. Retrieval owns embeddings,
   similarity and ranking. Product Search owns external candidates, normalization,
   verification and later shopping. Each branch adds separate modules and tests.
3. Coordinate inference request/error schemas, image ordering/bounds, raw evidence
   provenance and shared cross-language fixtures before connecting Python to Next.js.
   Coordinate dependency extras, supported Python versions and reproducible locks
   before installing ML packages. No model installation is required to begin design.
4. Future fusion is maintainer-coordinated (`TODO(Fusion)`); UI, Gemini improvements
   and review intelligence need separate assignments. Assumption: these are outside
   the three new branches except necessary agreed shared integration changes.
5. Product Search must agree on temporary reachable image transport before Lens.
   Current public provider interfaces and ProductCandidate should be reused where
   possible; source adapters do not decide final confirmation.

Nonblocking limits to address before enabling new live paths:

- The CFI-ZCT2W upgrade limitation and Gemini-only visual uniqueness assessment
  remain. Two model-reported features are not independent model/provider evidence.
- Live prices/reviews/candidate verification remain explicit 501 responses. The
  UI may request prices/reviews after live confirmation; errors remain visible.
- The camera screen's Demo selector is shown in live mode too, though the live
  provider ignores it and returned mode metadata remains accurate. Future UI work
  should make the initial mode presentation explicit.
- Offer sorting groups currency/condition, but the UI's highlighted lowest offer
  compares conditions within one currency. Coordinate grouping/labels before live
  shopping; do not present used/refurbished as equivalent to new.
- Global live configuration currently requires Gemini even for other provider
  operations. Revisit operation-specific validation when independent sources wire
  in; do not make Python or new credentials mandatory for existing Gemini/demo use.
- Upload signatures are checked but full decode/normalization is deferred. Images
  are memory-only; cache is process-local and nondurable. Python has no hosting or
  inference transport/authentication/readiness policy yet.
- Development lint audit findings and the Python TestClient deprecation warning
  are documented tooling follow-ups. Runtime npm audit is clean.

No remaining issue blocks starting isolated workstream development after the
baseline checks pass. Shared integration decisions above precede live wiring.

## Exact files changed

- `.gitignore`
- `.prettierignore`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `HANDOFF.md`
- `README.md`
- `docs/ui-flow.md`
- `eslint.config.mjs`
- `src/components/scan/use-camera.ts`
- `src/lib/ai/identification-output.ts`
- `src/lib/identification/fusion.ts`
- `src/lib/products/verification.ts`
- `src/lib/search/lens.ts`
- `src/lib/search/shopping.ts`
- `src/schemas/evidence.ts`
- `src/types/index.ts`
- `tests/e2e/demo.spec.ts`
- `tests/gemini.test.ts`
- `vision-service/README.md`
- `vision-service/pyproject.toml`
- `vision-service/app/__init__.py`
- `vision-service/app/main.py`
- `vision-service/app/models/__init__.py`
- `vision-service/app/schemas/__init__.py`
- `vision-service/app/services/__init__.py`
- `vision-service/tests/test_health.py`

## Post-commit local housekeeping

Only after validation and commit: recheck reachability/unique commits, remove
local `feature/architecture` and `feature/ui` with safe `git branch -d`, create
`feature/vision-ocr`, `feature/visual-retrieval` and `feature/product-search` at the
same final main commit, and remain on main. Remote old branches were verified
merged but are retained because no remote publishing/deletion was instructed.
The local baseline must be shared through the normal reviewed publishing workflow
before collaborators can fetch it; no push occurs in this task.

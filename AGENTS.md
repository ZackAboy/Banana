# Coding agent guide

This repository is an AI-powered visual shopping assistant for Banana Hacks.
Developers and their coding agents work in three independent evidence workstreams
through stable contracts with minimal merge conflicts. These instructions apply
throughout the repository.

## Before making changes

1. Read this file, `ARCHITECTURE.md`, and the shared types, schemas, API contracts,
   and provider interfaces relevant to your task.
2. Confirm your assigned workstream and inspect the current working tree. Preserve
   other developers' changes; do not overwrite, revert, or commit their work.
3. If a referenced document or contract does not yet exist, report that fact and
   your assumptions. Do not invent a competing architecture or initialize other
   workstreams unless explicitly assigned to do so.

The paths below describe the intended structure. They do not imply that every
module already exists.

## Workstreams

The previous Architecture and UI workstreams are merged and retired. This task
establishes a shared baseline on `main`; subsequent development uses these branches.

### OCR — `feature/vision-ocr`

Owns Python OCR modules in `vision-service/app/services/ocr*`, OCR schemas/model
loading modules and OCR-specific tests: PaddleOCR, text detection/recognition,
identifier/model/SKU/part-number extraction, and text normalization.
Must not implement Gemini, visual retrieval, external search, or UI redesign.

### Visual retrieval — `feature/visual-retrieval`

Owns Python retrieval modules in `vision-service/app/services/retrieval*`, retrieval
schemas/model loading modules and retrieval-specific tests: SigLIP/CLIP investigation,
product/candidate image embeddings, similarity calculations and candidate ranking.
Must not implement OCR, Gemini, external search, or UI redesign. Candidate discovery
is Product Search ownership; consume agreed candidate/image inputs.

### Product search — `feature/product-search`

Owns external candidate retrieval, general/product search, Lens where useful,
product candidate normalization, external verification, and later price-shopping
adapters in `src/lib/search/**` and `src/lib/products/**`. Review intelligence is
not assigned to this branch. Lens is a candidate/verification source, never the
sole identification mechanism. Must not implement OCR, embeddings, Gemini, or UI
redesign. Agree on temporary image transport before external image searches.

### Shared integration and deferred work

Gemini remains one semantic source. `src/lib/identification/fusion.ts` owns the
initial evidence-adjudication boundary; future fusion work combines independent
Gemini, OCR, retrieval, and external verification signals into the existing
`ProductIdentification`. No dedicated fusion branch is created yet. Coordinate
changes to this module, `src/lib/ai/**`, orchestration/APIs and provider/configuration
contracts with maintainers before integration. UI and reviews remain maintained
but have no new implementation assignment. `TODO(Fusion)` and `TODO(Reviews)`
are deferred maintainer work; `TODO(ProductSearch)` belongs to Product Search.
YOLO/object detection is explicitly deferred.

The Python entrypoint, health endpoint and `pyproject.toml` are shared. Add separate
OCR and retrieval modules/tests; do not independently redesign the service or
add heavyweight dependencies to the common default install. Coordinate model
extras, Python version constraints and inference transport contracts first.

## Shared files and contracts

Treat these as shared contracts:

- `src/types/**`
- `src/schemas/**`
- API request/response contracts, including validation and error shapes
- Environment configuration, including documented example variables
- Shared provider/service interfaces

Avoid changing shared contracts unless necessary. When a change is required:

1. Make the smallest possible change.
2. Preserve backwards compatibility when reasonable.
3. Update affected tests.
4. Clearly document the change and its impact in the commit/PR.
5. Do not refactor unrelated shared code.

Coordinate shared changes with affected workstreams. Do not rename or move
shared files without explicit instruction, and do not have multiple agents
independently redesign shared architecture.

## Agent rules

1. Read the guidance and relevant contracts listed above before making changes.
2. Stay within your assigned workstream unless explicitly instructed otherwise.
3. Do not perform unrelated refactors.
4. Do not rename or move shared files without explicit instruction.
5. Do not change another workstream's implementation for stylistic reasons.
6. Prefer adding functionality behind existing interfaces to changing interfaces.
7. Never commit API keys or secrets. Keep provider credentials server-side.
8. Follow the standard feature workflow and automated validation policy below.
   Report failures or unavailable checks accurately; never claim unperformed checks.
9. Report exactly which files you modified.
10. Report every shared contract changed, or explicitly state that none changed.
11. Report assumptions made about another workstream.
12. Leave actionable TODO comments naming the responsible workstream where it
    must supply functionality; do not implement its work yourself. Describe the
    expected interface and missing behavior without hiding the incomplete state.
13. Keep external service logic behind provider/service interfaces so mocks
    remain usable. Keep business logic outside API route handlers.
14. Preserve explicit mock mode while implementing live services. Keep mock
    data in dedicated services/fixtures and clearly identify demo data in the UI.
15. Never silently replace real failures with mock results. Surface failures
    through the agreed error contract.

Preserve the product's evidence-based behavior: never invent model numbers,
prices, retailers, reviews, or statistics. Keep source URLs, separate retrieved
evidence from AI interpretation, and preserve `confirmed`, `likely`, and
`uncertain` identification states. Model-generated confidence is not a calibrated
probability. Support additional images when evidence is insufficient. Match
product variants and distinguish new, used, refurbished, and unknown conditions
when comparing offers.

## AUTOMATED VALIDATION POLICY

- `npm run check` is the canonical offline repository validation command.
  CI runs the same command.
- It covers Vitest unit/integration tests, the production build, typecheck, lint,
  format check, and Playwright E2E tests.
- Add feature-specific tests to the existing suites so discovery includes them
  automatically. When introducing a new automated suite/check that should protect
  the repository, update `npm run check` in the same change so CI includes it.
- Do not introduce undocumented/manual validation commands that developers must
  remember. Document any required test setup in `CONTRIBUTING.md`.
- Live/network/model tests remain explicit opt-in and must not become required
  default validation. The canonical command disables live
  tests and forces mock services, without requiring credentials or `.env.local`.
- Do not weaken or remove checks merely to make CI green; diagnose failures and
  report any checks that could not run.

See [validation setup](CONTRIBUTING.md#checks-before-merging). CI also runs
`git diff --check` separately for Git whitespace errors.

## Integration principle

Communicate through stable contracts rather than importing another workstream's
internal implementation details.

```text
Frontend
    |
    v
API / Shared Contracts
    |
    +--------------------+--------------------+
    |                    |                    |
    v                    v                    v
Identification       Shopping              Reviews
    |                    |                    |
    +--------------------+--------------------+
                         |
                         v
                 Shared Domain Types
```

The target identification pipeline collects independent semantic/OCR/retrieval signals,
fuses evidence into candidates, and applies external verification. See
ARCHITECTURE.md for the target flow and current implementation limits.

Preserve these boundaries. Route handlers validate requests, invoke services,
serialize responses, and handle errors. Cross-workstream calls use agreed public
service/provider interfaces and shared domain types. Keep environment/model
selection centralized and retain the ability to run without real API keys.

## Standard feature workflow

Unless the user explicitly requests otherwise:

1. Start from a clean, up-to-date `main`: inspect branch/status, fetch
   `origin --prune`, and verify `main` matches `origin/main`. Stop and report
   unexpected local work or divergence; never overwrite or discard it.
2. Create a narrowly named branch: `feature/<name>` for product work,
   `fix/<name>` for fixes, or `chore/<name>` for repository/tooling work.
   Use the workstream branch names above when assigned to those workstreams.
3. Implement only the requested scope and add/update appropriate automated tests.
   Follow the automated validation policy above for new checks and opt-in live tests.
4. Before considering implementation complete, run `npm run check`. Do not rerun
   its constituent checks unless debugging a failure. Run `git diff --check` if
   the local canonical command does not already cover it.
5. Review `git diff` and `git status` for accidental files, secrets, `.env.local`,
   model caches, virtual environments, build artifacts, screenshots, and other
   local artifacts. Stage explicit files/hunks and inspect the staged diff.
6. After validation passes, commit with a clear conventional-style message and
   push the feature branch. Do not merge into `main` automatically. Deleting
   remote branches requires an explicit instruction.
7. Finish with the PR-ready handoff below, including validation and publishing status.

Use separate checkouts or worktrees when agents work concurrently so branch
switches and working-tree edits do not interfere. Each agent should commit only
work relevant to its assignment, including necessary, documented shared changes.
Avoid direct changes to `main`. Integrate through focused PRs, coordinating shared
contract changes before dependent work merges. Do not independently redesign
shared architecture on multiple branches.

## Agent handoff

End each task with a concise handoff containing:

- What was implemented
- Exact files changed
- Tests added/changed and executed, including the `npm run check` result
- Build/typecheck status, including checks not run and why
- Commit hash, branch name, and push status
- Shared contracts changed, or `None`
- Assumptions about other workstreams, or `None`
- TODOs for other workstreams, including the responsible owner
- Known issues or limitations, or `None`
- Suggested integration steps and any ordering dependencies

For documentation-only tasks, report the documentation checks performed and
mark runtime tests/build/typecheck as not run when they are not applicable or
the project tooling does not yet exist.

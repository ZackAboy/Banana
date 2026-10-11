# Contributing

Read `AGENTS.md`, `ARCHITECTURE.md`, and the relevant schemas/provider interfaces
before changing code. The initial setup spans all workstreams once to establish
a stable base. Subsequent work should follow these boundaries.

| Workstream       | Branch                     | Ownership                                                                      |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------ |
| OCR              | `feature/vision-ocr`       | Python OCR, PaddleOCR, text/identifier extraction and normalization, OCR tests |
| Visual retrieval | `feature/visual-retrieval` | SigLIP/CLIP, image embeddings, similarity and ranking, retrieval tests         |
| Product search   | `feature/product-search`   | External candidates/search/Lens, normalization/verification, later shopping    |

The previous Architecture/UI branches are retired after merging. All new branches
start from the same clean shared baseline. Gemini, evidence fusion, UI and review
intelligence have no new branch assignment. Coordinate shared integration with
maintainers; do not implement another workstream or create a fusion branch yet.
See AGENTS.md for exclusions and shared Python file ownership. YOLO is deferred.

Use a separate clone or worktree for concurrent agents. Do not let agents switch
branches in the same working directory. Avoid direct commits to `main` during
active development. Commit only assigned work, stage explicit files/hunks, and
preserve teammates' edits. Never commit secrets or `.env.local`.

## Shared changes and PRs

`src/schemas`, `src/types`, API request/response/error contracts, configuration,
and provider interfaces are shared. Coordinate a minimal, backwards-compatible
change with affected owners, update tests and docs, and merge it before dependent
work. Do not rename shared files, redesign architecture independently, or refactor
another workstream for style.

PRs explain the problem/result, exact scope, shared contract changes, evidence of
validation, assumptions about other workstreams, owner-tagged TODOs, known issues,
and integration order. For UI changes include screenshots when useful. Review
mock and live behavior; an API failure must remain a visible error rather than
becoming a synthetic success.

## Checks before merging

Use Node 24 LTS (`.nvmrc`) and a POSIX shell (macOS/Linux). Install dependencies
and the headless Chromium browser used by the existing Playwright configuration:

```sh
npm ci
npx playwright install --with-deps --only-shell chromium
npm run check
```

Browser/system dependency setup is needed after installing or upgrading Playwright,
not before each check. `npm run check` is the canonical offline validation command;
CI runs it too. It builds before typecheck/E2E to generate Next.js declarations and
the production server, disables both opt-in live suites, and forces mock services.
It sets `CI=1` so E2E starts a fresh production server rather than reusing a possibly
live development server. Port 3000 must be available. No `.env.local`, credentials,
Python environment, or local models are required.

Do not repeat the individual test/typecheck/lint/format/build/E2E commands after
`npm run check` succeeds. Follow the [automated validation policy](AGENTS.md#automated-validation-policy)
when adding tests or checks. Git whitespace validation remains a separate
`git diff --check` step in CI.

For the independent health-only service, follow `vision-service/README.md` and run
its pytest suite, Ruff lint, and Ruff formatting check. Python static type checking
is not configured yet. Coordinate inference HTTP contracts and dependency extras
before implementing adapters. The Next.js app does not require Python to run.

Keep tests focused on contracts and meaningful behavior. Report checks not run
and why. Verify the
demo works without API keys and preserves the additional-image flow. Check the
staged diff for secrets and unrelated changes before committing.

Live providers should validate external data, respect free-tier budgets, use the
existing cache where appropriate, and preserve source URLs. Never fabricate a
model, price, opinion, or review statistic. TODOs belong to the named workstream;
do not fill another owner's implementation behind their back.

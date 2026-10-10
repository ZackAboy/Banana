# Contributing

Read `AGENTS.md`, `ARCHITECTURE.md`, and the relevant schemas/provider interfaces
before changing code. The initial setup spans all workstreams once to establish
a stable base. Subsequent work should follow these boundaries.

| Workstream   | Branch                 | Ownership                                                                                                                                                                                                                                   |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture | `feature/architecture` | Gemini, identification/uncertainty, Lens/Shopping, verification/offers, review evidence/summarization/recommendations, caching/providers/orchestration/APIs, backend/unit/integration tests                                                 |
| UI           | `feature/ui`           | Design/components/layouts, responsive upload/camera/previews/multi-image UX, loading/errors/uncertainty/candidates, dashboard/prices/reviews/recommendations/sources presentation, accessibility/interactions/theme, frontend/browser tests |

UI uses existing mock providers and shared contracts; it must not implement
external API integrations. Architecture avoids presentation changes unless
required for a shared contract.

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

Use Node 24 LTS and `npm ci`, then run:

```sh
npx next typegen       # Generate ignored Next.js declarations on a fresh checkout
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Install Chromium once with `npx playwright install chromium`. Keep tests focused
on contracts and meaningful behavior. Report checks not run and why. Verify the
demo works without API keys and preserves the additional-image flow. Check the
staged diff for secrets and unrelated changes before committing.

Live providers should validate external data, respect free-tier budgets, use the
existing cache where appropriate, and preserve source URLs. Never fabricate a
model, price, opinion, or review statistic. TODOs belong to the named workstream;
do not fill another owner's implementation behind their back.

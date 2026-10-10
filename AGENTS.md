# Coding agent guide

This repository is an AI-powered visual shopping assistant for Banana Hacks.
Four developers and their coding agents should be able to work concurrently
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

### 1. Frontend

Primary ownership:

- `src/components/**`
- Frontend pages and layouts, including `src/app/**/page.tsx` and
  `src/app/**/layout.tsx`
- Upload, drag-and-drop, camera, image preview, and multi-image UX
- Loading, empty, error, and uncertain-identification states
- Result dashboard presentation, including identity, evidence, candidates,
  prices, review insights, sources, and recommendations

Consume shared types and service/API contracts rather than redefining them.
Keep provider credentials and external service calls out of client components.
Frontend ownership does not include API route contracts or backend business
logic merely because they live under `src/app/`.

### 2. Vision / Identification

Primary ownership:

- Identification modules in `src/lib/ai/**`
- Gemini client and multimodal product identification integration
- Image analysis, visible text/OCR, model/SKU clues, and identification evidence
- Uncertainty handling, requests for another useful image, and multi-image
  identification

Do not modify frontend components unless explicitly required. Review analysis
and recommendation modules within `src/lib/ai/**` belong to Reviews /
Recommendation. Treat a Gemini client or provider interface used by both
workstreams as shared infrastructure; coordinate changes to it.

### 3. Shopping / Product Search

Primary ownership:

- `src/lib/search/lens*`
- `src/lib/search/shopping*`
- `src/lib/products/**`
- Candidate discovery and verification
- Product normalization and matching exact models and variants
- Price retrieval, offer matching, and condition-aware comparisons

Do not modify unrelated AI or frontend modules. Expose candidate verification
through agreed service contracts so Identification can consume it without
depending on shopping internals.

### 4. Reviews / Recommendation

Primary ownership:

- Review discovery/search modules, including Google Search and Reddit discovery
- Review evidence processing and source attribution
- Review summarization and analysis modules, including those in `src/lib/ai/**`
- Evidence-grounded recommendation generation

Do not modify unrelated shopping or frontend modules. Consume the shared Gemini
client/provider interface rather than creating a separate configuration or
changing identification internals.

Each workstream owns its relevant tests and dedicated mock implementations and
fixtures. Shared mock selection, configuration, caching, and orchestration need
coordination. If ownership is ambiguous, resolve it before changing the disputed
implementation; continue independent work in your assigned scope.

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
8. Run relevant tests and TypeScript checks before finishing. Run relevant lint
   and build checks when available; report failures or unavailable checks
   accurately and never claim verification that was not performed.
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

Preserve these boundaries. Route handlers validate requests, invoke services,
serialize responses, and handle errors. Cross-workstream calls use agreed public
service/provider interfaces and shared domain types. Keep environment/model
selection centralized and retain the ability to run without real API keys.

## Git workflow

Use one feature branch per workstream as a starting convention:

- Frontend: `feature/frontend`
- Vision / Identification: `feature/vision`
- Shopping / Product Search: `feature/shopping`
- Reviews / Recommendation: `feature/reviews`

Use separate checkouts or worktrees when agents work concurrently so branch
switches and working-tree edits do not interfere. Each agent should commit only
work relevant to its assignment, including necessary, documented shared changes.
Stage explicit files or hunks; inspect the staged diff for unrelated edits and
secrets. Avoid direct changes to `main` during concurrent development. Integrate
through focused PRs, coordinating shared contract changes before dependent work
merges. Do not independently redesign shared architecture on multiple branches.

## Agent handoff

End each task with a concise handoff containing:

- What was implemented
- Exact files changed
- Tests executed and their results
- Build/typecheck status, including checks not run and why
- Shared contracts changed, or `None`
- Assumptions about other workstreams, or `None`
- TODOs for other workstreams, including the responsible owner
- Known issues or limitations, or `None`
- Suggested integration steps and any ordering dependencies

For documentation-only tasks, report the documentation checks performed and
mark runtime tests/build/typecheck as not run when they are not applicable or
the project tooling does not yet exist.

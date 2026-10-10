# Initial setup handoff

## Implemented

- Next.js App Router/React application with strict TypeScript, Tailwind, locally
  owned shadcn/ui primitives, Radix Slot, Lucide, Zod, official Gemini SDK,
  Vitest, ESLint, Prettier, npm, and Playwright. Direct versions are pinned.
- Responsive upload/drop/camera controls, transient previews, four-image support,
  shared size limits, MIME/signature validation, bounded request bodies, loading,
  empty/error states, light/dark appearance, and accessible controls.
- Mock end-to-end identity, candidate verification, price comparison, review
  evidence/sources, caveats, and purchasing recommendation.
- Deterministic uncertain flow: one image requests a label, two images confirm
  the sample. Candidate selection is explicitly described as a demo user choice.
- Thin API routes with validation and sanitized error envelopes; service/provider
  interfaces; centralized server configuration and a bounded TTL cache with
  in-flight request deduplication. Price/review loads run concurrently after
  confirmation and support independent failures/retries.
- README, architecture, team workflow, environment example, and ignored secrets.
  Existing `AGENTS.md` is retained unchanged.

## Validation completed

| Check                    | Result                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Dependency installation  | Passed with supported Node 24 toolchain                                                                                 |
| `npm run typecheck`      | Passed                                                                                                                  |
| `npm run lint`           | Passed, no warnings                                                                                                     |
| `npm test`               | 21 tests passed across 5 files                                                                                          |
| `npm run build`          | Production build passed, including TypeScript                                                                           |
| `npm run test:e2e`       | 5 Chromium tests passed against production server                                                                       |
| `npm run format:check`   | Passed                                                                                                                  |
| Application launch       | Production server launched by Playwright and served the app                                                             |
| Mock flow                | Confirmed, follow-up image, candidate choice, failure/retry verified                                                    |
| Responsive appearance    | Desktop and 390px mobile screenshots reviewed; dark foreground and no horizontal overflow verified                      |
| Runtime dependency audit | `npm audit --omit=dev`: 0 vulnerabilities                                                                               |
| Credential checks        | No credential-pattern matches in created source/config/docs; environment files and build/dependency directories ignored |

Browser tests exercise uploads, preview/removal, analysis, recommendations, reset,
mobile theme behavior, and a forced review failure followed by retry. Hardware
camera capture, live APIs, and actual Vercel deployment have not been verified.
No API keys were supplied or committed. No Git commit was created by this task.

## Shared contracts introduced

This empty repository had no previous shared contracts to preserve. Created:

- `src/schemas/domain.ts`: identification/status/candidates/offers/review schemas
- `src/schemas/api.ts`: request/response, mode metadata and error schemas
- `src/types/index.ts`: inferred shared domain/API types
- `src/lib/providers/interfaces.ts`: public service/provider boundaries
- `src/lib/config/env.ts` and `.env.example`: validated environment/model selection
- `src/lib/upload.ts`: shared upload limits/validation
- Four `src/app/api/**/route.ts` files: HTTP contracts documented in README

## Assumptions and remaining work

The first setup is authorized to span all workstreams once. Subsequent work uses
AGENTS.md ownership and these stable interfaces. Mock mode defaults on; images
are not actually analyzed in the demo. Live adapters intentionally return 501,
and missing live configuration returns 503. Real failures never return fixtures.

| Owner / branch                | TODO and extension points                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend / `feature/frontend` | Refine upload/dashboard with live error and uncertainty responses in `src/components/**`; preserve API schemas                                                                                                      |
| Vision / `feature/vision`     | `src/lib/ai/identification.ts`: structured Gemini multimodal reasoning/OCR across all images; evidence-based status; shared Gemini client and central model configuration                                           |
| Shopping / `feature/shopping` | `src/lib/search/lens.ts`, `shopping.ts`, `src/lib/products/verification.ts`: Lens/Shopping calls, exact model/variant verification, normalized conditions/currencies/offers; agree on temporary image URL transport |
| Reviews / `feature/reviews`   | `src/lib/search/reviews.ts`, `src/lib/ai/reviews.ts`: retrieve source evidence and summarize/recommend with attribution and insufficiency handling                                                                  |

Identification is expected to use the public Lens/verification interfaces when
its live pipeline is wired. Review analysis is expected to consume retrieved
sources and shared Gemini initialization rather than duplicate configuration.
These are declared integration assumptions, not completed live behavior.

Known issues/limits:

- Prices, retailers, identity evidence, and review opinions are synthetic fixtures;
  offer/review links are explicitly labeled example.com placeholders.
- Lens needs temporary reachable image transport; no hosting/storage is added.
- Upload signatures are checked; full decode/normalization is future Vision work.
- Cache is process-local and nondurable, with no coordination across instances.
- Next's React/import/accessibility lint plugins currently require ESLint 9;
  ESLint 9 is deprecated. The lint dependency chain has 5 high-severity audit
  findings from an unpatched `braces` advisory. Runtime audit has 0 findings.
- The host initially had Node 23/npm 10 resolver issues; verification used Node
  24.21.0 and current npm. Use `.nvmrc` before installation/checks.

## Integration steps

1. Review and commit this starter as the shared base; no existing source was
   overwritten. Keep `AGENTS.md` with the base.
2. Create a branch and separate checkout/worktree per workstream. Read architecture
   and contracts first; coordinate shared changes in a small prerequisite PR.
3. Replace live placeholders behind the existing interfaces and preserve explicit
   mock mode. Run typecheck/lint/tests/build and browser checks before merging.
4. For the demo run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`
   under Node 24. No credentials are required with `USE_MOCK_SERVICES=true`.
5. Use Vercel's Next.js preset and Node 24 for a future deployment; publishing is
   outside this setup. See README for commands, environment and provider links.

## Exact files created in this task

- `.env.example`
- `.gitignore`
- `.nvmrc`
- `.prettierignore`
- `.prettierrc.json`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `HANDOFF.md`
- `README.md`
- `components.json`
- `eslint.config.mjs`
- `next-env.d.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `postcss.config.mjs`
- `src/app/api/identify/route.ts`
- `src/app/api/prices/route.ts`
- `src/app/api/products/verify/route.ts`
- `src/app/api/reviews/route.ts`
- `src/app/error.tsx`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/not-found.tsx`
- `src/app/page.tsx`
- `src/components/identification/candidate-products.tsx`
- `src/components/identification/identification-evidence.tsx`
- `src/components/identification/product-identity-card.tsx`
- `src/components/prices/price-comparison.tsx`
- `src/components/product/demo-preview.tsx`
- `src/components/recommendation/recommendation-card.tsx`
- `src/components/reviews/review-insights.tsx`
- `src/components/reviews/sources.tsx`
- `src/components/shopping-assistant.tsx`
- `src/components/theme-toggle.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/upload/image-upload.tsx`
- `src/lib/ai/client.ts`
- `src/lib/ai/identification.ts`
- `src/lib/ai/reviews.ts`
- `src/lib/api/client.ts`
- `src/lib/api/http.ts`
- `src/lib/api/identify-input.ts`
- `src/lib/cache/memory.ts`
- `src/lib/config/env.ts`
- `src/lib/errors.ts`
- `src/lib/mock/fixtures.ts`
- `src/lib/mock/providers.ts`
- `src/lib/products/normalization.ts`
- `src/lib/products/offers.ts`
- `src/lib/products/verification.ts`
- `src/lib/providers/index.ts`
- `src/lib/providers/interfaces.ts`
- `src/lib/search/lens.ts`
- `src/lib/search/reviews.ts`
- `src/lib/search/shopping.ts`
- `src/lib/services/analysis.ts`
- `src/lib/upload.ts`
- `src/lib/utils.ts`
- `src/schemas/api.ts`
- `src/schemas/domain.ts`
- `src/types/index.ts`
- `tests/api.test.ts`
- `tests/cache.test.ts`
- `tests/e2e/demo.spec.ts`
- `tests/products.test.ts`
- `tests/schemas.test.ts`
- `tests/server-only.ts`
- `tests/upload.test.ts`
- `tsconfig.json`
- `vitest.config.ts`

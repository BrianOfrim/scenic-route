# Policy draft pages — validation evidence

Completed October 9, 2026 on codex/prelaunch-policy-drafts, isolated managed worktree created from 6283736df5be9a4d92a08bef0e84a427e915f89f. Shared primary checkout was not edited.

## Delivered

- docs/terms-of-service.md and docs/privacy-policy.md are incomplete review drafts with explicit status and no effective date.
- Public /terms and /privacy (including trailing slashes) render those exact Markdown sources through Vite raw imports. Policy pages mount before App, bypassing its session lookup. Existing API server serves the SPA for public paths.
- Native draft-policy links appear in the landing footer, sign-in/signup flows including Google entry, and account settings. No acceptance checkbox, signup gating, age verification, or consent record was introduced.
- Semantic article/main/header/footer, one h1, ordered h2 sections, keyboard skip link, underlined links, visible focus, readable text size, wrapping, and scrollable page layout.
- Separate internal publication notes list unverified facts and launch dependencies. No shared prelaunch-checklist edit.

## Checks

Dependencies installed in the isolated worktree with npm ci --ignore-scripts --no-audit --no-fund; no lockfile change. Initial borrowed dependency tree was replaced because it lacked Better Auth.

- npm run build: passed (TypeScript web project build and Vite). Existing large chunk warning remains.
- npm test -w @scenic-route/web: 204 passed, 0 failed/skipped. Four new tests cover exact public routing, document headings/draft status/source links, and escaping/unsafe-link handling. Test runner explicitly selects tsconfig.app.json for the React JSX runtime.
- node_modules/.bin/tsc -p apps/api/tsconfig.json: passed after installing lockfile dependencies.
- node_modules/.bin/tsx --test apps/api/src/accountDeletion.test.ts apps/api/src/posterQuota.test.ts apps/api/src/llmTrace.test.ts: 19 passed, 0 failed/skipped, using local development PostgreSQL and temporary fixtures. Covers account/file purge and storage failure, UTC quota boundaries/variants/failures, and trace payload handling. No real customer emails or AI requests.
- git diff --check: passed.
- Browser at localhost:5186: /terms renders without sign-in; Tab exposes skip link and Enter moves focus to main#policy-content; /privacy/ renders at 375 × 812 with no horizontal overflow. Draft status, source headings, email and cross-policy links are visible. Desktop layout inspected. Landing footer and Create account mode contain both draft links; signup was not submitted. Temporary viewport override reset.

## Limitations and integration

Authenticated settings links were inspected in source and typechecked; no real account was used for an authenticated browser walkthrough. Deletion/provider data handling was not verified in production. No accessibility certification or counsel review is claimed.

Merged origin/main through d039e7c on October 9, 2026. The web test script keeps both `src/LegalPage.test.tsx` (with `tsconfig.app.json` for JSX) and `src/share.test.ts`, and MapLibre is `^6.13.0`. Signup, the waitlist screen, and account settings keep the draft policy links beside the eligibility control. `/terms` and `/privacy` render before `ParticipationGate`, so they stay public without a session lookup. The application admits 100 accounts and waitlists the rest; the default allowance remains 50 images per UTC month. Eligibility, Terms, and AI-consent checks from main stay fail-closed because the policy version and route variables are empty. These drafts are not approved acceptance text. Provider routing/countries, log and backup retention, mailbox/operational procedures, and final legal publication remain unresolved in policy-publication-notes.md.

## Recheck after merging origin/main

- npm test -w @scenic-route/web: 207 passed, 0 failed/skipped. Includes the policy page tests and src/share.test.ts.
- npm run build -w @scenic-route/web: passed. The existing large chunk warning remains. The production bundle contains the updated admission and privacy wording.
- npx tsc -p apps/api/tsconfig.json --noEmit: passed.
- Account deletion, poster quota, and llm trace tests: 21 passed. Beta admission tests: 7 passed. Local PostgreSQL required CREATEDB on the scenic role before the admission suite could create its temporary databases.

After the further merge of origin/main at d039e7c (eligibility/consent and dependency patches): web tests 207 passed; API typecheck passed; web production build passed with the same large-chunk warning; beta admission 7 passed and participation unit/integration tests 9 passed. `/terms` and `/privacy` stay outside the participation gate.

No deployment, production account change, or final publication approval was performed.

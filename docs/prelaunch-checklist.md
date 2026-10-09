# Scenic Route prelaunch checklist

Prepared October 8, 2026. All boxes start unchecked: this is a release checklist, not evidence that a feature is missing or a check has failed. Check an item only after verifying it in the intended production environment.

Support and privacy contact: [info@scenic-route.ca](mailto:info@scenic-route.ca). Verify the inbox can receive messages and is monitored before launch.

Operator and person responsible for support and privacy requests: Brian Ofrim. Operator location: Alberta, Canada.

Initial target markets: Canada and the United States. Account eligibility: users must be at least 13 years old.

Launch model: free public beta limited to 100 admitted accounts, with a waitlist for additional users. Generation allowance: 50 images per account per UTC calendar month.

## Readiness reassessment — October 9, 2026

Assessment of local revision `3175b16`: substantial implementation is integrated, but public-beta release readiness is not yet established. Local integration and production verification are separate gates. Earlier unchecked items below have not all been reconciled with merged work.

### Implemented in the current code

- Account deletion and associated account-data purge (#144), per-account monthly image quotas, fair image scheduling and insufficient-credit handling (#146).
- Transactional 100-account beta admission, waiting-account restrictions, and operator admission CLI (#150); see `prelaunch-evidence/public-beta-cap-waitlist.md`.
- Cross-account authorization/file-access hardening (#151), bounded import/archive handling (#152), and dependency advisory patches (#155).
- Release/recovery/incident runbooks (#149), public **draft** terms/privacy pages (#153), and versioned participation/AI-consent infrastructure (#154, simplified in #156). Implementation does not establish final policy approval or production activation.
- Current defaults are 128 global active image requests, eight active per user, 16 unfinished jobs per user (active/waiting/backoff), and eight theme/palette combinations. Production values/capacity are not verified. The earlier “eight waiting in addition to active” description should be reconciled with the actual unfinished-job admission rule.

### Release issues and remaining decisions

- Finalize policies and their effective versions/routes. The repository defaults for `TERMS_VERSION`, `AI_CONSENT_VERSION`, `TERMS_ROUTE`, and `PRIVACY_ROUTE` are empty; unconfigured protected use fails closed. No production secret values were inspected.
- Eligibility reconciled October 9, 2026: Brian confirmed **13+**, matching current code and Terms (`age-13-plus-v1`). The checklist and draft privacy wording now match. Teenage-user consent and location-data safeguards still require review before final policy publication.
- Decide and verify log/trace/backup retention, deletion exceptions, actual processor countries, and model-provider settings before making final privacy promises.
- Resolve the licensing review's Esri reference-image/AI pipeline and Garmin FIT SDK hosted-use questions. OSM tile-proxy compliance, deterministic export attribution, distribution notices, and sample-asset provenance also remain open; see `licensing-review.md`.
- Resolved October 9, 2026 in merged PR #157 (`76c14d2`): participation integration tests now isolate database/storage fixtures from legacy bootstrap state. The production bootstrap safeguards were preserved. A fresh run of participation integration and bootstrap tests passed all nine tests, including the previously failing email and Google flows.
- Sensitive-log redaction is not present in this revision: traces retain request/response content, and persistence failure can print the full trace. Dependency patches landed separately; do not count those as logging remediation.
- Brian will configure the $50 monthly spending alert directly through cloud services; no application spending-alert implementation is required. Provider-side setup remains unverified. The additional beta/sharing-guidance chat was canceled and reverted. Brian confirmed that this guidance should not be added to app screens; include necessary disclosures in the Terms page only.

### Current verification evidence

- Fresh `npm run build`: passed; existing large-chunk warning remains.
- Earlier API test run at `3175b16`: **370 passed, 2 failed, 372 total**. Both failures were subsequently fixed in PR #157; fresh targeted participation/bootstrap validation at `76c14d2` passed **9/9**. The full suite has not been rerun in this reassessment after the fix. The earlier initial sandbox run could not start tsx IPC; reported runs used permitted execution outside that restriction.
- Fresh `npm run test:web`: **207 passed, 0 failed**.
- Not verified in this reassessment: live deployment revision/configuration, email delivery and inbox receipt, Google production availability, bucket privacy/lifecycle, backup restore, rollback rehearsal, monitoring/alerts, actual provider billing settings, or production load/browser smoke checks.
- PR merge evidence above comes from local Git history. Live PR status could not be queried because Origin CLI authentication was unavailable; no login, deployment, or production settings changes were initiated.

Recommended order: settle retention/provider facts and finalize policies; resolve licensing or choose permitted alternatives; then run final integrated release checks and verify deployed controls, recovery, email/OAuth, and the end-to-end smoke flow before opening the public beta. Eligibility wording and the reported bootstrap test failures have been reconciled.

## Launch decisions

- [x] Identify the operator and person responsible for support and privacy requests: Brian Ofrim, reachable at info@scenic-route.ca.
- [x] Confirm the operator's location: Alberta, Canada.
- [ ] Deferred at Brian's request: assess applicable Alberta business-name registration requirements for operating as Scenic Route. Not assessed or completed.
- [x] Choose initial target markets: Canada and the United States.
- [x] Decide account age eligibility: at least 13 years old (confirmed October 9, 2026).
- [ ] Assess applicable Canadian and US requirements for teenage users, meaningful consent, any required parental permission, and location-data safeguards. Legal review is recommended.
- [x] Decide launch model: free public beta.
- [x] Confirm the public generation allowance: 50 images per account per UTC calendar month.
- [x] Set the public beta admission cap: 100 accounts, with additional users joining a waitlist.
- [x] Set the monthly AI spending budget: $75 as an operator budget target. Use the prepaid OpenRouter account balance as the spending control rather than implementing an application-level monthly cap. At the operator's estimated $0.01 per image, 100 accounts using their full allowance would cost approximately $50/month for successful images, excluding other costs and potentially charged failures/retries.
- [x] Decide daily AI spending policy: no daily limit.
- [x] Choose spending-alert threshold: alert Brian Ofrim at $50 in monthly AI spend.
- [x] Choose spending-alert management: Brian will configure it directly through cloud services; no application implementation required.
- [x] Define per-user capacity: eight active image requests and eight waiting jobs; reject whole batches that would exceed the waiting limit with a clear error. Global active-request ceiling: 128.
- [x] Limit each generation batch to eight selected theme/palette combinations; model choices and variants do not count as extra combinations.
- [x] Define exhausted-funds behaviour: return a clear generation error when OpenRouter rejects a request for insufficient prepaid credit. Do not retain failed requests for automatic resumption after a calendar reset or balance refill; users can retry manually.
- [x] Implement and verify the approved queue limits and exhausted-funds error handling locally; see local implementation evidence below. Production verification remains open.
- [x] Name the person responsible for release approval, incidents, and customer requests: Brian Ofrim.

## Must complete before public launch

### Terms, privacy, and consent

- [ ] Publish Terms of Service covering account eligibility, acceptable use, upload rights, processing permissions, generated-image usage, quotas, suspension, termination, and liability.
- [ ] Verify the implemented 13+ age-eligibility policy in production for email and Google signup and the terms; verify how known underage accounts are handled.
- [ ] Review the Terms page's AI-artwork accuracy and navigation disclaimer; do not add this guidance to app screens.
- [ ] Publish a Privacy Policy matching actual collection and processing: account details, GPS tracks, activity statistics, optional names, prompts, images, logs, and cookies.
- [ ] Identify relevant processors and purposes: Fly.io, Neon, Cloudflare R2, Resend, Google sign-in, OpenRouter, the actual image provider, and map services. Verify processing locations and retention rather than assuming them.
- [ ] Disclose AI processing clearly before first generation, including the route-derived reference images and selected text sent externally. Implement and record appropriate consent.
- [ ] Add accessible policy links to the landing page, signup, and account settings; record the terms version and acceptance time for both password and Google signup.
- [ ] Decide how existing users will receive new policies and provide any required acceptance or consent.
- [x] Inspect repository cookies and analytics (October 8, 2026): Better Auth authentication/session and temporary OAuth-state cookies; `scenic-route.variants` localStorage preference; no advertising, product analytics, or session-replay integration found. Installed Better Auth telemetry defaults to disabled. Browser requests also include Google Fonts, Google sign-in/profile images when used, and configured MapLibre glyph resources; map tiles are proxied through the API. This is a source-code inventory, not a live production traffic audit.
- [ ] Verify actual production cookies/network traffic and expiry behaviour for password and Google sign-in; disclose necessary storage and external resource requests in the Privacy Policy and implement any applicable consent controls.
- [ ] Have legal counsel review the policies and consent flow against the actual product and launch markets.

### Data rights, deletion, and retention

- [x] Define account-data retention policy: retain user account data while the account exists; on account deletion, delete associated user data. Some user-related information may remain in logs. This is the intended policy; implementation and any log/backup exceptions must be verified before publication.
- [ ] Specify which user-related information may remain in logs after account deletion, its purpose, and its retention period; disclose the exception clearly in the Privacy Policy.
- [ ] Provide a working account-deletion process, self-service or through support, with identity verification and a stated completion timeframe.
- [ ] Verify deletion covers account/session records, imported tracks, posters, thumbnails, saved references, and other account-linked records or objects; document any justified exceptions.
- [ ] Define retention periods for generation traces, temporary uploads, caches, inactive accounts, and backups; implement cleanup where applicable.
- [ ] Verify the R2 lifecycle rule deletes temporary `references/` objects after seven days without deleting persistent poster assets.
- [ ] Distinguish temporary batch references from saved references needed for poster edits; test both lifecycles.
- [ ] Provide a process for personal-information access/correction requests and withdrawal of consent; explain any backup deletion delay.
- [ ] Review traces and application logs for route coordinates, personal text, tokens, signed URLs, and image content; minimize sensitive logging and restrict access.
- [ ] Verify the selected OpenRouter endpoint/provider's retention and training settings. Ensure policy claims match those settings.

### Licensing and attribution

- [ ] Review OpenStreetMap data licensing and tile-service rules for the actual request pattern, caching, and traffic.
- [ ] Review OpenTopoMap and Esri imagery terms for reference capture, AI-provider submission, derived artwork, distribution, and commercial use.
- [ ] Determine and implement attribution requirements for the interactive maps, reference images, and downloaded/shared posters.
- [ ] Confirm image-model/provider terms support the intended output usage; avoid promises of exclusive ownership or copyright protection that cannot be supported.
- [ ] Review fonts, icons, dependencies, sample tracks, and promotional images for redistribution/commercial-use requirements.
- [ ] Review public theme names and marketing references for trademark or implied-affiliation concerns.

### Security and abuse prevention

- [ ] Enforce the 100-account beta cap on the server for email and Google signup, including simultaneous signups; waitlisted users cannot import or generate until admitted.
- [ ] Implement a waitlist and an operator-controlled admission process; define how existing, operator, unverified, and deleted accounts count toward the cap.

- [ ] Verify one account cannot read, edit, delete, generate from, or fetch another account's tracks, posters, jobs, or references—including guessed IDs and direct asset URLs.
- [ ] Verify R2 objects are private, signed links expire as intended, and sharing exposes only what the user deliberately shares.
- [ ] Verify production auth uses HTTPS, secure cookies, a strong secret, correct trusted origins, and appropriate protection for state-changing requests.
- [ ] Verify signup, sign-in, password reset, verification email, and import/generation endpoints have appropriate abuse controls.
- [ ] Test upload size limits, archive expansion limits, malformed GPX/FIT/TCX files, and unsafe archive paths.
- [ ] Confirm secrets are absent from frontend bundles, tracked files, and logs; restrict operator/cloud access and enable MFA where available.
- [ ] Review production dependency vulnerabilities and resolve material findings.
- [ ] Verify prepaid OpenRouter billing configuration, including that automatic top-ups are disabled for the intended prepaid spending control, and confirm billing currency. Implement and verify a clear insufficient-credit generation error with manual retry and no automatic resumption.
- [ ] Brian: configure and verify the $50 monthly AI spending alert directly through cloud services; confirm coverage, currency, recipient, and monthly reporting boundaries. No application implementation required.

### Production operations

- [ ] Verify production domain, TLS, auth callback URLs, environment variables, and email sender configuration.
- [ ] Test verification and reset emails with real inboxes, including delivery, expiry, and repeated requests; verify SPF/DKIM and set an appropriate DMARC policy.
- [ ] Confirm Google sign-in is available to intended public users rather than only designated testers.
- [ ] Configure database and image-storage recovery appropriate to the launch; restore a sample account, track, and poster in an isolated environment.
- [ ] Add uptime/error monitoring and actionable alerts without including sensitive user content.
- [ ] Test deployment rollback and migration recovery; document operator steps.
- [ ] Keep the current in-memory generation queue on one API process/machine. Decide and document what users see when restart discards unfinished jobs.
- [ ] Verify the shared image scheduler in production: eight active requests per user, 128 globally, fair turns between waiting users, eight waiting-job admission places per user, whole-batch rejection, and the eight-combination selection cap. Verify that automatic retry requires a free waiting place and otherwise leaves a failed job for manual retry; test database/account-lock capacity before operating near 128 active requests. No global waiting-job cap was requested.
- [ ] Test provider timeouts, rate limits, outages, and storage failures; ensure errors are understandable and retry behaviour does not silently duplicate work.
- [ ] Confirm quota reservations recover after failures and successful outputs are counted as advertised.
- [ ] Establish a privacy/security incident response process, including how applicable reporting and notification obligations are assessed.

### Product acceptance

- [ ] Complete a production smoke test with a new account: signup → verification → import → generate → gallery → download/share → refine → sign out/in.
- [ ] Test Google sign-in, password reset, expired sessions, and deletion/request flows.
- [ ] Test representative GPX, FIT, TCX, compressed tracks, and Strava export ZIPs, including large and invalid files.
- [ ] Test mobile and desktop flows, keyboard access, visible focus, labels, contrast, and understandable errors.
- [ ] Check downloaded/shared output quality, including route fidelity, title/text accuracy, attribution, and image dimensions.
- [ ] Verify galleries are private by default; put any necessary sharing/privacy disclosure in the Terms page, without adding sharing or crop/hide guidance to app screens.
- [ ] Review necessary generation-limit, availability, failure/retry, and free-beta disclosures in the Terms page; no additional app-screen guidance is requested.
- [ ] Publish info@scenic-route.ca as the support contact in the Terms page and privacy contact in the Privacy Policy; test receipt of a customer request.
- [ ] Run `npm test` and `npm run build` against the release revision; resolve failures and record the revision and results.

## Additional gate if charging at launch

Not applicable to the planned free public beta. Complete these checks before introducing paid access.

- [ ] Publish pricing, currency, taxes/fees, generation allowances, and what counts as usage before purchase.
- [ ] Define failed-generation, refund, cancellation, renewal, and unused-credit policies as applicable.
- [ ] Verify payment-provider integration, webhook authenticity/idempotency, receipts, entitlement changes, and payment failure/recovery.
- [ ] Test cancellation and refunds end to end; ensure the product matches the advertised policies.
- [ ] Confirm applicable business registration, consumer-protection, and tax obligations with qualified advisers.

## Local implementation evidence

October 8, 2026, working tree: shared ownership-aware image scheduling covers queued gallery batches and direct generation/refinement/variants. Queued jobs (including automatic-retry backoff) and direct requests waiting for a slot share the eight-place per-user admission allowance; Generating jobs are active, and Completed/Failed jobs consume neither allowance. Batch admission and manual retries reserve waiting capacity atomically. The composer and server enforce eight theme/palette combinations per batch; older restored setups retain selections but cannot generate until reduced to eight. Eight is a hard waiting ceiling: transient retries reserve a waiting place; if the queue filled during the attempt, the job stays Failed with its prepared prompt and a clear manual-retry message. No global image backlog cap was added, so admitted work waits when the 128-active-request ceiling is reached. The separate account-lock pool is explicitly configured for 128 connections, matching the scheduler ceiling; 32 relevant account-deletion, credit, job-queue, and scheduler tests plus API TypeScript checking passed after this adjustment. Production connection capacity remains unverified.

Insufficient-credit rejections are classified from OpenRouter HTTP/structured code 402 and `metadata.limit_source`, with temporary in-flight spending capacity distinguished from depleted credit. Queued jobs become Failed, direct generation/refinement/variants show a clear service-credit error, and quota and scheduler reservations are released. Failed jobs require manual retry; neither balance refill nor a calendar reset resumes them. Spending control remains the prepaid OpenRouter balance, with no application-level monthly spending cap.

Local validation: `npm test` passed 315 API tests and 201 web tests; `npm run build`, API TypeScript checking, and `git diff --check` passed. Tests cover concurrency, fairness, shared direct/gallery limits, simultaneous whole-batch admission, manual and automatic retries, failures, timeout cleanup, selection validation, billing-error classification, direct refinement/variant propagation, no automatic credit retry/resumption, quota accounting, account scoping, and scheduler-before-account-lock ordering for direct image routes. Providers were mocked; no deployment or production load test was performed. The build retains its existing large-chunk warning. These results do not mark the production gates complete. Beta admission/waitlist, production prepaid billing configuration, and the $50 spending alert remain separate work.

## Release sign-off

- [ ] Every applicable public-launch gate has evidence of completion; mark inapplicable items with a reason rather than checking them silently.
- [ ] Record the release revision, deployment time, approved policies, known limitations, and rollback owner.
- [ ] Start with a controlled initial audience and observe support load, generation failures, latency, and AI spend before expanding.

## Reference guidance

These are starting points, not a determination of which laws apply. Recheck provider terms and legal requirements before release.

- [Canadian privacy consent guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/?wbdisable=true)
- [Alberta organization privacy responsibilities](https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information)
- [OpenRouter privacy policy](https://openrouter.ai/privacy/)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

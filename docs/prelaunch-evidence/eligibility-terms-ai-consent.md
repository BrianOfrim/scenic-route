# Eligibility, Terms and AI consent — prelaunch evidence

Validated 2026-10-09. Base: `6283736df5be9a4d92a08bef0e84a427e915f89f`. Branch: `codex/eligibility-consent`. Work was isolated in the attached managed worktree; the primary checkout was not edited.

## Behavior and records

- The approved eligibility rule is an explicit attestation that the user is **at least 18 AND has reached the age of majority where they live**. No full birth date or residence is collected. This is attestation, not independent identity/age verification.
- Email verification and Google authentication can provision an account/session. Provisioning alone grants no protected application access. Every new and existing session must attest eligibility and accept the current Terms before protected use, including profile mutation. Account recovery/authentication, sign-out, participation choices, account deletion and privacy contact remain available.
- AI consent is a separate explicit choice. Users may decline it and use non-generation features. Generation, refinement, new variants, queued submissions and retries require current AI consent. `generatePoster`, `modifyPoster` and `variantPoster` each check the persisted requirements before reading input/references or calling a provider; the queue uses these functions at execution time.
- The disclosure states that route-derived reference images and selected text go to OpenRouter and the selected model provider; the current poster also goes when refining. Existing saved-poster variants use grounding, without sending the prior poster, as before.
- Append-only `participation_events` store user, event kind (eligibility/Terms/AI separately), version, accepted/refused choice and server timestamp. Latest event per kind governs access. User deletion cascades to these records. Client-supplied truthy strings, omitted choices, stale versions and blocked-account reattestation are rejected.
- Terms version changes require renewed Terms acceptance; AI disclosure version changes stop generation until renewed AI consent. Eligibility uses `adult-majority-v1`. Change that identifier if the eligibility rule changes.
- Users can revisit choices through Settings → Eligibility, Terms and AI consent. Refusing Terms blocks protected use; refusing/withdrawing AI consent stops future generation. Consent changes hold the existing exclusive account lock and return 409 while work is active, so users must retry after active work completes. Already completed provider processing cannot be undone.
- Self-declared ineligibility is persisted as a restriction, and a user cannot clear it through public APIs. This deliberately prevents flipping an attestation back to true after an underage declaration.

## Policy integration dependency — not launch approval

The separately reviewed policy-pages PR must land before enabling this feature. **No policy draft is treated as approved.** The new environment variables intentionally have empty defaults; protected use fails closed while configuration is incomplete.

After review, configure `TERMS_VERSION`, `AI_CONSENT_VERSION`, `TERMS_ROUTE` and `PRIVACY_ROUTE`. Routes must be same-site absolute paths (e.g. `/terms` and `/privacy`); versions must identify the exact reviewed/published documents and disclosure. Keep the published versioned documents available for audit. Bump the applicable version when its substance changes. Do not set these values merely to make the gate disappear.

Integrate the policy routes into public application routing. The participation wrapper lets the configured policy URLs and `/reset-password` render without acceptance. The policy-page PR must render its public pages there instead of the ordinary application; anonymous readers must also be able to access them. Do not deploy this PR alone with populated routes pointing to missing/draft pages.

Owner/contact context for policy review: Brian Ofrim, Alberta, Canada; `info@scenic-route.ca`. The 50-images/month limit remains in the existing quota implementation; this PR does not implement a 100-account admission cap or change that limit.

## Queue integration dependency

Queue changes are pending in another chat. This PR does not edit `generationJobs.ts` or its scheduling behavior. Retain the service-level consent checks when integrating that work. If queued jobs begin calling another provider entry point, that path must check persisted eligibility/current Terms/current AI consent at execution, not just enqueue time. New HTTP generation paths must also be included in `generationPath`. Failed jobs after consent withdrawal stay failed and may be retried only after current requirements are met.

## Operator handling of a known underage account

Using the intended environment, run:

```sh
npx tsx scripts/restrict-underage-account.mts user@example.com
```

The command uses local `.env.local`/`.env` as existing operator scripts do. Confirm the intended database before running it. It takes the exclusive account lock, sets `eligibility_blocked`, and appends `operator-known-underage-v1` with accepted=false. If there are requests in progress it refuses; retry once they finish. Do not use a concurrent SQL update to bypass that lock. Queued work cannot generate after restriction. The session remains useful for self-service deletion and privacy requests; protected use is blocked.

Handle privacy/deletion requests through `info@scenic-route.ca` and the existing account-deletion workflow; apply the reviewed retention policy. This PR sends no customer email and does not automatically purge accounts. Correcting a mistaken restriction requires operator review, followed by an explicitly authorized correction; there is intentionally no public unrestrict API. Do not request a full birth date as a routine workaround.

## Validation

- `DATABASE_URL=postgres://scenic:scenic@127.0.0.1:5432/scenic_eligibility_test npm test`: **300 API + 200 web tests passed**, zero failures/skips.
- `npx tsc --noEmit -p apps/api/tsconfig.json`: passed.
- `npm run build`: passed; existing Vite large-chunk advisory remains.
- `git diff --check`: passed.
- New tests use real Better Auth email-verification/password sessions and Google ID-token sessions (Google signature verification mocked only in the test provider). They exercise new/existing users, direct API bypass attempts, both version changes, strict choices, refusal, restrictions, protected versus recovery routes, service-level generation gates, queued execution/retry after withdrawal, consent/account-lock races, timestamped separate events and deletion cascade. No real auth emails or provider requests are sent.
- Operator command tested against a disposable user in the dedicated local test database: restriction=true and the expected audit event were verified, then the disposable user was removed.
- Local mock-only browser preview visually checked at desktop 1280×720 and mobile 390×844. Explicit checkboxes, disclosure, privacy contact, sign-out and deletion disclosure fit and remain readable. No real account or legal acceptance was submitted through the browser.
- Initial full API run was 297/298 because `examples/canadian-routes/west-coast-trail.gpx` is an ignored local fixture absent from a fresh worktree. Copied the existing primary-checkout fixture into the isolated worktree (still ignored), reran the affected tests and then the complete suites successfully. CI still needs that fixture or the separate fixture-cleanup work.

No merge, deployment, production/cloud change or real customer email was performed. Remaining release checks: integrate reviewed public policy pages, set approved versions/routes, confirm the pending queue implementation preserves the gates, and smoke-test the complete production auth/cookie flow after integration. Real Google OAuth and email delivery were not exercised against external services.

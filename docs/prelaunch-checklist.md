# Scenic Route prelaunch checklist

Updated October 10, 2026. This checklist contains outstanding work only. Implemented features are listed here only when production verification or another specific follow-up remains.

## Agreed launch scope

Brian Ofrim operates Scenic Route from Alberta, Canada, with support and privacy requests handled at [info@scenic-route.ca](mailto:info@scenic-route.ca). The free public beta targets Canada and the United States, accepts users aged 13+, and admits up to 100 accounts with a waitlist. The default allowance is 40 generated images per account per UTC calendar month.

The AI budget target is $75/month, controlled through prepaid OpenRouter credit, with no daily cap. Brian will configure the $50 monthly spending alert directly through cloud services. Current scheduler defaults are 128 active requests globally, eight active per user, and 16 unfinished jobs per user; generation batches allow eight theme/palette combinations. Verify deployed settings and admission behaviour before relying on these limits.

Terms and Privacy Policy wording is approved by Brian, effective October 10, 2026, and merged in PR #161. Additional beta/sharing guidance is not requested on app screens; necessary disclosures belong in the Terms. User approval does not establish counsel review or verification of provider and retention arrangements.

## Policies and consent

- [ ] Deploy the customer-facing Terms and Privacy Policy from PR #161; verify both pages and their links have no draft labels in production.
- [ ] Replace the temporary production draft Terms/AI-consent versions with appropriate approved versions. Keep the routes at /terms and /privacy; verify new and existing users are prompted for the updated agreement and the versions/timestamps are recorded. Reading policies, sign-out, and deletion must remain available before acceptance.
- [ ] Verify the 13+ eligibility and agreement flows in production for Google sign-in and known underage accounts. The password-account agreement flow was smoke-tested with temporary draft versions.
- [ ] Assess teenage-user consent, any required parental permission, and location-data safeguards for Canada/US users; obtain legal review of policies and consent where needed.
- [ ] Confirm actual processors, purposes, processing countries, and OpenRouter/Meta endpoint retention/training settings. Update policy disclosures to match verified arrangements.
- [ ] Verify production cookies, browser requests, and expiry behaviour for password and Google sign-in; implement any applicable consent controls. The repository cookie/analytics inventory is complete.

## Retention and deletion

- [ ] Define which user-related information can remain in logs after deletion, why, and for how long. Set bounded trace/log/cache/backup retention and implement cleanup; update the Privacy Policy with confirmed exceptions and periods.
- [ ] Verify account deletion in production removes account/session records, activities, posters, thumbnails, references, and account-specific traces/caches. Document backup, provider, historical-object-version, and legacy-file exceptions; confirm the completion timeframe and partial-failure retry process. The deletion implementation and local tests are complete.
- [ ] Verify the R2 lifecycle rule removes temporary references after seven days without deleting persistent poster assets or saved references needed for edits; test both reference lifecycles.
- [ ] Establish the support process for access/correction requests, consent withdrawal, deletion assistance, identity verification, and applicable response deadlines.
- [ ] Complete sensitive-log minimization/redaction and production access restrictions. Current traces can retain request/response content and print it on persistence failure; the dependency patch did not complete the separate log-redaction work.

## Licensing and attribution

- [ ] Complete OSM database/schematic licensing and attribution for reference images and exported/shared posters. OSM Standard Streets proxy caching and display safeguards are already implemented and production-smoke-tested.
- [ ] Resolve Esri imagery capture/storage, AI-provider submission, derived-artwork distribution, and required credits through confirmed permission or a permitted alternative.
- [ ] Confirm OpenTopoMap capture/adaptation and share-alike requirements before enabling that use.
- [ ] Resolve Garmin FIT SDK hosted-import permissions or choose a suitably licensed alternative.
- [ ] Implement deterministic, source-aware export attribution across downloads, ZIPs, sharing, refinements, variants, and legacy posters; confirm any remaining imagery-specific display credits.
- [ ] Confirm applicable OpenRouter/Meta output-use terms, provenance/watermark obligations, geographic restrictions, and any alternate selectable model's requirements.
- [ ] Complete distribution notices for shipped dependencies/fonts/native binaries and verify glyph-service rights. Record provenance/permissions for public sample posters, routes, logos, and promotional assets.
- [ ] Review public theme names, marketing references, and outputs for trademark or implied-affiliation concerns.

See [licensing review](licensing-review.md) and [OSM validation evidence](prelaunch-evidence/osm-tile-compliance.md).

## Production security and capacity

- [ ] Verify deployed beta admission/waitlist behaviour for email and Google signup, concurrent admission, returning accounts, and deletion freeing capacity. Confirm the existing admitted count and intended operator exemption. Implementation and adversarial local tests are complete.
- [ ] Verify cross-account isolation in deployed activity/poster/job/reference routes and direct asset access. Local authorization hardening/tests are complete.
- [ ] Verify R2 privacy, signed-link ownership/expiry, and deliberate sharing behaviour.
- [ ] Complete production auth checks for strong secrets, secure cookies, trusted origins, OAuth callbacks, and state-changing request protections. HTTPS and unauthenticated activity rejection were already smoke-tested.
- [ ] Verify signup, sign-in, verification/reset email, import, and generation abuse controls in the deployed configuration.
- [ ] Check maximum-size supported imports and representative GPX/FIT/TCX/gzip/Strava ZIPs on the production runtime. Parser/size/expansion/path safeguards and local tests are complete; heap/CPU behaviour under large input remains unverified.
- [ ] Verify secrets are absent from shipped frontend assets and production logs; restrict cloud/operator access and enable MFA where available.
- [ ] Verify scheduler capacity and fairness in production, including whole-batch rejection, unfinished-job accounting, retries, eight-combination selections, and database/account-lock capacity near 128 active requests. Reconcile the earlier eight-waiting description with the implemented 16-unfinished rule.
- [ ] Verify failure handling for provider timeouts/rate limits/outages, storage failures, exhausted credit, and quota reservation recovery; check manual retry does not duplicate work unexpectedly. Local scheduler/quota/credit tests are complete.
- [ ] Verify prepaid OpenRouter configuration, automatic top-ups disabled for the intended spending control, and billing currency.
- [ ] Brian: configure and verify the $50 monthly spending alert through cloud services, including coverage, recipient, currency, and reporting boundaries. No app implementation required.

## Operations and final acceptance

- [ ] Verify Google OAuth is available to the intended public audience, rather than only designated testers.
- [ ] Test password-reset delivery, expiry, verification/reset repeat requests, and email DNS (SPF/DKIM/DMARC). Production email signup/verification was already smoke-tested.
- [ ] Verify info@scenic-route.ca receives support/privacy messages and is monitored. Contact links are already present in both policies.
- [ ] Configure database and image recovery and restore a sample account/activity/poster in an isolated environment; verify production backup windows and retention.
- [ ] Configure uptime/error monitoring and actionable provider/cloud alerts without sensitive content.
- [ ] Rehearse deployment rollback and migration recovery using the existing [operations](runbooks/operations.md) and [recovery](runbooks/recovery.md) runbooks.
- [ ] Confirm the single-process deployment remains appropriate for in-memory jobs and agree on handling interrupted work at restart. Restart behaviour is documented; unfinished work is not durable.
- [ ] Operationalize the existing [privacy incident runbook](runbooks/privacy-incident.md), including relevant reporting/notification assessment and contacts.
- [ ] Complete the production end-to-end flow: import → generate → gallery → download/share → refine → sign out/in; also test Google login, expired sessions, deletion, and privacy-request handling.
- [ ] Check mobile/desktop and keyboard flows, focus, labels, contrast, and errors beyond the completed Streets map smoke test. Check output fidelity, text accuracy, dimensions, and credits.
- [ ] Run the full suite, type checks, dependency audit, and build on the final release revision; record results. Earlier Node 22 release validation passed 416 API and 207 web tests, and PR #161 policy rendering/build checks passed; final-revision checks remain required.
- [ ] Record release/deployment revision, policy/consent versions, known limitations, and rollback details; confirm all applicable remaining gates have evidence before opening the beta.
- [ ] Expand the initial audience gradually while observing generation failures, latency, support load, and AI spending.

## Deferred

- [ ] Alberta business-name registration assessment is deferred at Brian's request; not assessed or completed.

Paid-product pricing, payment, refund/cancellation, and tax setup are outside the free-beta launch scope. Revisit them before introducing paid access.

## Evidence and reference guidance

Completed implementation and verification records are retained in [prelaunch evidence](prelaunch-evidence/), Git history, and merged PRs. The October 9–10 production smoke covered HTTPS/health/auth rejection, password signup/verification/agreement, desktop/mobile Streets attribution, and persistent tile reuse after restart. It did not establish the outstanding generation, storage, recovery, Google, or billing checks above. Local PostgreSQL/API availability and Google configuration were restored October 10; that does not verify production OAuth.

[Canadian consent guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/), [Alberta privacy responsibilities](https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information), [OpenRouter privacy policy](https://openrouter.ai/privacy/), and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

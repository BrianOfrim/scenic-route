# Internal publication notes — policy drafts

Status: incomplete, not approved for final legal publication. Inspected base 6283736df5be9a4d92a08bef0e84a427e915f89f on October 8, 2026. No production settings or cloud accounts were changed or inspected. No counsel review has been completed.

## Confirm before publication

- Brian Ofrim, Alberta, Canada, and info@scenic-route.ca are supplied facts. Verify the mailbox works and determine whether a mailing/service address or other disclosures are required. Counsel should review Alberta/federal Canadian law and applicable US consumer/privacy requirements, liability, content license, acceptable use, dispute wording, and notice/consent.
- Canada/US residency is still not checked. After merging origin/main (d039e7c), the application admits up to 100 counted accounts and waitlists later email and Google signups (`beta_status`). The same main includes an eligibility attestation (at least 13, with no birth date) plus separate Terms and AI-processing choices. Those checks fail closed until `TERMS_VERSION`, `AI_CONSENT_VERSION`, `TERMS_ROUTE`, and `PRIVACY_ROUTE` are set to approved documents. These drafts are not those documents: the variables stay empty, and accepting a checkbox against this draft is not implemented. `/terms` and `/privacy` render outside `ParticipationGate`, so reading them does not fetch a session. Waitlisted accounts can sign in, edit the profile, and delete the account; imports and poster generation return 403 `BETA_WAITLISTED` before consent is considered. Protected use also returns 403 `PARTICIPATION_REQUIRED` until the approved versions are configured and accepted.
- db.ts still defaults to 50 monthly images; posterQuota.ts uses UTC month windows, including edits and variants. Per-account overrides, including unlimited, exist. Fair per-user image scheduling from main is included in this merge (128 active image requests per process, eight active and 16 unfinished per user by default, operator-managed per-account limits). Signup, the waitlist screen, and account settings keep the draft policy links beside that admission copy. Verify deployed limits, failure refunds, and queue behaviour before publication.
- Approve and implement bounded retention for diagnostic traces, infrastructure/access logs, backups, temporary files, and map caches. Retention periods and backup erasure are unverified. llmTrace.ts stores requests/responses and can log content on persistence failure. Do not promise no logging or complete erasure. Account deletion removes files before database rows; partial failure may require retry. Verify R2 purge and restores in deployment. Browser preferences and previously downloaded/shared copies remain.
- Confirm actual PostgreSQL host/region, Fly.io deployment/volumes, R2 bucket/jurisdiction, Resend settings, contracts, subprocessors, access safeguards, and retention. fly.toml specifies dfw but does not establish actual residency. storage.ts supports R2/local storage. Provider headquarters and example configuration are not residency proof.
- Confirm OpenRouter account controls, contracts, planning/image models, endpoint routing, and each processor's countries/training/retention. .env.example selects meta/muse-image; planning is separately configured. openrouter.ts does not establish per-request no-training or zero-retention enforcement. The provider listing alone does not verify actual handling. Review minimization of precise GPS inputs.
- Confirm privacy request handling, identity verification, legally required response times, deletion assistance, consent withdrawal, complaints, and breach response. Draft rights wording is not operational verification.
- Recheck deployed network resources. No analytics SDK/tracker was found in inspected code; this is not a production injection or third-party audit. Google Fonts, profile images, and MapLibre glyphs request directly from browsers; map tiles are proxied through the API.

## Code inspected

- auth.ts and db.ts: Better Auth email/name/photo, hashed passwords, provider credentials and sessions (IP/user agent); optional Google; Resend verification/reset emails; HttpOnly/Lax cookies and Secure with HTTPS; default session duration not overridden.
- accountDeletion.ts: stored activity/account/session/credential/usage/image/reference/trace/scene purge; no verified backup or provider erasure. An anonymous bootstrap marker remains to prevent legacy-data reclaim.
- llmTrace.ts, openrouter.ts, planner.ts, poster.ts, referenceUploads.ts, storage.ts: generation data, diagnostic traces, stable end-user account identifier, images/uploads. API paths are under apps/api/src/.
- osm/location.ts, landmark.ts, overpass.ts, tiles.ts: Nominatim, Overpass, OSM/OpenTopoMap/Esri geographic requests. apps/web/src/MapView.tsx: remote MapLibre glyphs; apps/web/index.html: Google Fonts; ProfileMenu.tsx: Google image with no-referrer.
- apps/web/src/poster/imageModels.ts: scenic-route.variants device preference; deletion does not clear it.
- apps/api/src/index.ts: authentication only on /api/* and SPA fallback for public pages. main.tsx renders /terms and /privacy before ParticipationGate and App, so reading a policy does not fetch a session. The gate still wraps the rest of the app.

## Official sources checked October 8, 2026

- [OpenRouter providers](https://openrouter.ai/providers/): Meta reports no training/30-day retention; US is headquarters, not processing countries.
- [OpenRouter privacy](https://openrouter.ai/privacy): provider policies vary; actual configuration remains unverified.
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management), [options](https://better-auth.com/docs/reference/options), [cookies](https://better-auth.com/docs/concepts/cookies): seven-day default, session refresh, temporary OAuth cookies.
- [Google Fonts privacy information](https://developers.google.com/fonts/faq/privacy): redirected to Google Fonts FAQ; verify browser resource handling before publication.
- [Resend privacy](https://resend.com/legal/privacy-policy) and [DPA](https://resend.com/legal/dpa): no account-specific retention or contract audit performed.
- [Cloudflare R2 US jurisdiction](https://developers.cloudflare.com/changelog/post/2026-08-17-r2-us-jurisdiction/): jurisdiction depends on configuration; availability does not prove this bucket's location.
- [Alberta access/correction](https://www.alberta.ca/accessing-your-personal-information.aspx) and [use/consent](https://www.alberta.ca/using-personal-information): informed rights wording, not a determination of all applicable law.

## Release boundary

Resolve factual items, complete required legal review, publish approved effective/version dates, and integrate reviewed adult/consent controls before relying on these drafts as final terms or privacy notices. This PR does not complete launch legal approval.

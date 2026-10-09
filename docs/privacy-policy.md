# Privacy Policy

Draft for review — October 9, 2026. Not yet effective. This incomplete draft describes inspected code and intended practices. Provider settings, retention periods, and publication review remain unresolved; it is not a final privacy notice or a request for consent.

## Who is responsible

Brian Ofrim operates Scenic Route from Alberta, Canada. Contact [info@scenic-route.ca](mailto:info@scenic-route.ca) with privacy questions, access or correction requests, deletion requests, or concerns. The [draft Terms of Service](/terms) describe the proposed Canada/US beta for users aged 13 and older.

## Information processed and why

Account information includes email address, name, optional profile image, verification status, public-beta admission status (admitted or waiting), and account identifiers. When approved policy versions are configured, the combined age confirmation, Terms, and AI-processing agreement is stored with the relevant versions and timestamps. The combined checkbox records age confirmation, Terms acceptance, and AI consent as separate audit events. Account deletion removes those choice records with the account. Email/password authentication stores password credentials in hashed form; Google sign-in, when enabled, stores linked provider credentials and profile information. Sessions include technical information such as IP address and user agent. These support sign-in, account security, and account management. Verification and password reset emails contain your email address and authentication links.

Uploaded GPX, FIT, TCX, and archive activity files are processed to extract GPS coordinates, routes, dates, activity names, and available statistics such as distance, duration, elevation, and speed. Imported activity records and tracks are stored for your account. Routes may reveal homes, routines, or other sensitive locations.

Images, reference uploads, prompts, poster settings, selected names and places, generated images, and generation usage records are processed and stored to create, edit, organize, and download artwork, enforce quotas, and diagnose failures. Diagnostic traces can include prompts, model responses, and route-related content; removing image payloads from a trace does not remove all personal information. Information you send by email is used to respond to your request.

## Providers and external resources

The code sends selected route context, prompts, reference images, and generated-image edit inputs to OpenRouter and the model providers it routes to. Requests can include a stable pseudonymous account identifier for abuse isolation; this does not make the content anonymous. The example configuration selects meta/muse-image for image generation; planning uses a separately configured model, and image model selection can vary.

[OpenRouter's provider listing](https://openrouter.ai/providers/) describes Meta as not training on requests and retaining data for 30 days. This listing is not a verified promise about every request or model. [OpenRouter's privacy policy](https://openrouter.ai/privacy) and provider policies also apply. Actual routing, training controls, retention, and processing countries remain unconfirmed for this deployment. We cannot currently promise no training, zero retention, deletion from all providers, or Canada-only processing.

The repository uses PostgreSQL for accounts and activities, supports local or Cloudflare R2 image storage, includes Fly.io hosting configuration, and uses Resend for authentication email when configured. These services receive the information needed for storage, hosting, authentication email, and delivery. Production configuration, contracts, and processing locations need verification before final publication.

Mapping requests use OpenStreetMap tiles, OpenTopoMap, Esri imagery, Nominatim, and Overpass services as needed. Server requests convey geographic areas, coordinates, place searches, or tile locations, rather than forwarding the full account profile. Browser resources include Google Fonts, MapLibre font resources, and Google-hosted profile images when available. Direct browser requests can expose IP address, browser information, and request metadata to those resource providers. [Google Fonts privacy information](https://developers.google.com/fonts/faq/privacy) describes its font-request handling. We found no analytics or advertising trackers in the inspected application code; external providers have their own practices.

## Cookies and device storage

Necessary Better Auth cookies support sign-in and security. The default session duration is seven days and may refresh with activity; sign-out ends the session. Temporary OAuth cookies support the Google sign-in flow. Cookie names and duration can depend on the authentication library and configuration. Blocking necessary cookies can prevent sign-in. See [Better Auth session documentation](https://better-auth.com/docs/concepts/session-management) and [cookie documentation](https://better-auth.com/docs/concepts/cookies).

The browser stores your preferred number of image variants in localStorage under scenic-route.variants. It persists until replaced or cleared in your browser and is not an analytics identifier. Account deletion does not currently clear this device preference. Downloads and copies you share or keep on your device are outside the account deletion process.

## Retention and deletion

The intended policy is to retain account data while the account exists and purge associated service data when the account is deleted. Account settings implement deletion of stored activities, account records, sessions, provider credentials, usage records, posters, reference uploads, and account-specific diagnostic traces and scene caches. A storage failure can interrupt deletion and require retry. This describes the application deletion path, not a verified end-to-end production erasure guarantee.

Infrastructure logs, backups, independent provider records, caches, and legal retention may follow different lifecycles. Their retention periods and deletion procedures have not been approved or verified, so this draft gives no deadline for complete erasure and does not promise deletion from all third-party systems. Those facts must be resolved before final publication.

## Your choices and requests

You can edit your account name, remove activities or posters, download generated artwork, and request account deletion in settings. Contact us for access to or correction of personal information, consent withdrawal, deletion assistance, or a privacy complaint. We may need to verify your identity. Withdrawal may prevent us from providing features that require the information, subject to applicable legal obligations. Applicable privacy rights and access to regulators are preserved.

Avoid submitting other people's personal information without permission. The proposed beta is for people aged 13 and older. The application can store a combined age confirmation, Terms, and AI-processing agreement once approved policy versions are configured. It does not collect a birth date or verify age independently. This draft is not that approved text. The service is not intended for children under 13. Notices and consent processes for teenage users should account for their understanding and the sensitivity of route and location information.

## Security, disclosure, and updates

The code uses account-scoped access controls and authentication protections, but no system can guarantee complete security. We may need to disclose information where required by law or to address abuse or protect safety, subject to applicable law. Final publication must confirm these practices, provider arrangements, and any additional legal disclosures. A final notice will identify its effective date and explain material updates.

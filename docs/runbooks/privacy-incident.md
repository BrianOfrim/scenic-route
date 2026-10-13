# Privacy and security incident response

Incident lead: Brian Ofrim. Customer/privacy contact: info@scenic-route.ca.

## Contain and preserve

1. Record discovery time, reporter, affected services/releases, and known facts. Isolate affected access and revoke compromised credentials while preserving essential evidence.
2. Preserve private logs, request/trace IDs, provider access evidence, deployment history, and backup manifests. Record who collected each item and when. Keep raw customer data, GPS, credentials, and signed URLs out of Git and public tickets.
3. Establish the exposure window, affected accounts, data categories, access gained, and likely misuse. Consider location/home/work exposure, routes, images, emails, and authentication data. Record uncertainty and revisit the assessment when new evidence arrives.

Pausing image generation alone does not contain a data-access incident. Identify the affected API, storage, database, sessions, and provider credentials separately.

## Assess reporting and notification

Determine applicable jurisdictions from the affected people and processing, with qualified advice when needed. Consult current regulator guidance for reporting thresholds, deadlines, required notice contents, and record retention; avoid copying legal requirements into operational commands:

- Alberta: [OIPC breach notification guidance and forms](https://oipc.ab.ca/breach-notification/).
- Canada where PIPEDA applies: [OPC breach reporting, notification, and record guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/).
- US: [FTC response guide](https://www.ftc.gov/business-guidance/resources/data-breach-response-guide-business), plus the relevant state authorities and any applicable sector regulator.

Record applicability, harm/risk rationale, discovery and determination dates, required deadlines, recipients, sources consulted, reviewer, and submission evidence. Keep documented below-threshold decisions too. Do not wait for perfect information once a reporting obligation arises. Incident-record duties are separate from general log and backup retention.

## Communicate and recover

Prepare notices from verified facts: what happened, when, affected data, containment, protective steps, and the contact above. Brian approves regulator, customer, and provider communications. Avoid unsupported assurances or unnecessary disclosure of other people's information.

Use [recovery.md](recovery.md) for data restoration and [operations.md](operations.md) for release recovery. Verify containment and remediation, reconcile account deletions, record remaining uncertainty, and assign preventive actions before closing the incident.

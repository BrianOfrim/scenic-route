# Live geography smoke test

Use this opt-in check to diagnose geography loading against real Overpass data:

```sh
npm run test:geography:live
npm run test:geography:live -- --strict
npm run test:geography:live -- --case victoria
npm run test:geography:live -- --output /private/tmp/geography-run
```

Start local PostgreSQL and initialize the application schema first. The script refuses remote databases and disables migrations. It creates disposable synthetic accounts/activities, isolates storage and caches, and cleans up fixtures on normal completion. An interrupted run can leave `geography-smoke-*` accounts or temporary directories; inspect those before cleanup.

[scripts/geography-smoke.mts](../../scripts/geography-smoke.mts) owns the case list and checks. It calls the real geography route in-process through authentication, account access, ownership, and participation middleware, with injected test session lookup. It does not test browser rendering, TCP, or normal sign-in, and does not add a bypass to the running server.

Cases exercise different scale profiles/aspect ratios with cold query caches, warm query-cache reuse, and saved-scene reuse. Wide frames must avoid Overpass. Fallbacks are warnings by default; `--strict` fails on fallback or empty scenes. Failed checks exit nonzero. Public provider latency varies; there is no fixed speed assertion.

Default reports go to `data/geography-smoke/<UTC timestamp>/`, ignored by Git:

- `report.json`: case results, timings, sources, warnings, feature counts, and failures.
- `timings.jsonl`: geography timing events and endpoint health/cooldowns.
- `api-YYYY-MM-DD.jsonl`: application logs.

The script is excluded from `npm test` because it uses live services and can take several minutes. `OVERPASS_URL` selects a single endpoint when configured. Inspect reports before retrying; do not turn this into bulk cache warming or a provider load test.

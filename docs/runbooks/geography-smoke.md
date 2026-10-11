# Live geography API smoke test

Run `npm run test:geography:live` with local PostgreSQL running and the application
schema already initialized. This opt-in test calls the real
`GET /api/poster/geography/:activityId` route through Hono's in-process request
interface, including authentication, account access, activity ownership, and
participation middleware. It fetches real Overpass data. It does not test TCP,
the normal sign-in flow, browser transfer, or rendering.

The test creates a uniquely named disposable account and synthetic activities
in the local database, then removes those fixtures. It refuses remote database
hosts and disables migrations. Session lookup uses the same injection point as
the API integration tests; it does not add an authentication bypass to the
running server. Cache and scene files use a fresh temporary directory via
`OSM_CACHE_DIR`, and poster storage is isolated. Existing account data and map
caches are preserved. Interrupted processes can leave a `geography-smoke-*`
fixture account or temporary cache directory; normal completion cleans both up.

## Coverage

- Central Park short run: close-up, square.
- Edmonton river-valley run: local, portrait.
- Lake Louise mountain hike: local, portrait.
- Victoria coastal ride: local, landscape.
- Winnipeg city ride: town, tall portrait.
- Netherlands rural ride: district, widescreen.
- Banff–Canmore regional ride: regional, portrait.
- Alberta multi-day overview: wide, portrait, bundled Natural Earth assets.

Frames approximate cropped route windows with real location centers and ground
dimensions. The fixtures cover all six automatic profiles and all five poster
aspect ratios. The API currently derives geography from frame and aspect, not
the fixture's track geometry.

Each case issues three sequential requests:

1. **Cold**: fresh isolated Overpass cache; confirms a miss for detailed scenes.
2. **Warm**: repeat the same request without a scene ID; confirms query-cache
   reuse when the cold request successfully populated the cache.
3. **Saved**: reopen the cold request's scene ID; confirms saved-scene reuse.

Wide frames must avoid Overpass completely. Requests check HTTP status, expected
scale profile, valid feature collections, and scene identity. Failed checks
produce a nonzero exit code. Geography fallback is valid application behavior
and is recorded as a warning by default; add `--strict` to fail on fallback or
empty scenes. Provider responses deliberately omitting oversized map objects
are allowed as partial scenes. Public provider latency varies, so there is no
fixed speed assertion.

## Commands and artifacts

```sh
npm run test:geography:live
npm run test:geography:live -- --strict
npm run test:geography:live -- --case victoria
npm run test:geography:live -- --output /private/tmp/geography-run
```

Default output is `data/geography-smoke/<UTC timestamp>/`, ignored by Git:

- `report.json`: per-location/phase status, elapsed API time, source, completeness,
  warnings, feature count, response sizes, endpoint attempts, and failures.
- `api-YYYY-MM-DD.jsonl`: application logs retained by the normal file logger.
- `timings.jsonl`: all `geography.timing` events, including endpoint health and
  cooldown events, linked by load ID.

Reports are updated after every request. Endpoint health is shared across cases
within a run and starts fresh in each process. Only one location is requested
at a time; normal tile concurrency, retry budgets, and cooldown behavior apply.
The script is excluded from `npm test` because it depends on live services and
can take several minutes. `OVERPASS_URL`, if exported/configured, selects a
single endpoint just as it does in the application.

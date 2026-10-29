# Poster judge trial

This developer experiment evaluates saved poster/reference pairs through an image-capable OpenRouter chat model. It does not affect generation, gallery publication, retries or quotas. Results are model judgments requiring human review, not certified route measurements.

The v3 rubric reports three independent criteria using `pass`, `fail`, `uncertain` or `not_applicable`:

- **Route quality** (`route_quality`): both similarity to the reference route shape and correct placement relative to shorelines, roads, crossings and landmarks. Both checks must pass. Ignore route color, stroke width and texture. Allow changes to overall framing, but do not independently move the route against its background to align it. Mirroring, rotation, stretching and local warping fail.
- **Background geography** (`background_geography`): land/water shapes, roads, feature positions and land cover compared with schematic and satellite imagery. Ignore the route and markers entirely; allow the requested artistic style.
- **Design quality** (`design`): route visibility, text legibility, composition and style adherence. Exact text accuracy is not a separate criterion.

Route quality always receives an assessment. Failures require localized evidence. A wrong route cannot lower the background-only score. Input images are normalized to PNG with a maximum edge of 2048 pixels, preserving aspect ratio and never enlarged.

The retained four-criterion trial is migrated explicitly, rather than presented as fresh inference: route quality passes only when both old route checks pass, fails if either fails, and otherwise retains uncertainty. Placement `not_applicable` for a shape-only control uses its shape verdict. Human route quality is migrated only when both old human ratings exist; other ratings and notes stay unchanged. The original v2 files remain intact. Derived results retain source request IDs/hashes, original response text and a derivation rule; they use an evaluation hash rather than pretending a new model request was sent. No API calls are needed for this combination. The v3 prompt applies this joint requirement directly for future evaluations.

## Run

Create a local manifest. Paths are resolved relative to the manifest. Use an explicit small selection (1–20 cases); the runner never enumerates accounts or retrieves remote posters. Keep private inputs and reports outside version control.

```json
{
  "cases": [
    {
      "id": "sample-1",
      "label": "Example route · Watercolor",
      "kind": "poster",
      "candidate": "poster.png",
      "references": [
        { "file": "route.png", "role": "route-only; red line is the GPS track" },
        { "file": "schematic.png", "role": "schematic; red line is the GPS track" }
      ],
      "brief": {
        "style": { "name": "Watercolor" },
        "text": { "title": "Example route", "subtitle": "", "stats": [] }
      },
      "expectedRouteVerdict": null
    }
  ]
}
```

Use `kind: "shape-control"` for isolated synthetic path tests. Optionally give a known `expectedRouteVerdict` (`pass` or `fail`); expected answers, case labels, IDs and filenames are withheld from the model. The report compares these labels after inference. Ground truth must come from construction or human review, not another model verdict.

```sh
npm run poster:judge -- --manifest /absolute/path/manifest.json --dry-run
npm run poster:judge -- --manifest /absolute/path/manifest.json --out /absolute/path/results
npm run poster:judge -- --manifest /absolute/path/manifest.json --out /absolute/path/results --report-only
npm run test:poster-judge
```

The live command sends the selected images and brief to OpenRouter and incurs model charges. It reads `.env.local`, then `.env`, preserving existing environment variables. Set `OPENROUTER_API_KEY`; model precedence is `--model`, `OPENROUTER_JUDGE_MODEL`, then `OPENROUTER_MODEL`. The runner verifies image input, text output and structured-output support against the model catalog before submitting.

Requests run sequentially within each batch, with a five-minute timeout, a 12,000-token completion allowance and no automatic retry. Provider failures, truncated responses, malformed JSON and invalid verdicts remain errors. `results.json` is checkpointed after each case and includes the prompt version, response, request hash, latency and reported cost (unknown stays null). `report.html` embeds the exact evaluated images beside expandable judgments. Keep it private: images, route locations, titles and other supplied details are embedded. Use a new output folder for each run to retain earlier results. Use `--no-report` for bulk batches to save only results without repeatedly embedding images in HTML.

`--report-only` rebuilds HTML from saved results and the local image files without making network calls or incurring charges. Retain the original image files unchanged for reproducibility; the request hash records the exact original request, including its images.

## Interpret the trial

Start with identical and recolored paths, a transformed-but-equivalent path, a mirrored path and an omitted loop, plus several real posters. Synthetic controls establish only simple shape behavior, not robustness to illustrated backgrounds. Human-label the real examples before measuring false acceptance and false rejection. Include subtle path errors and repeated requests before considering an automatic gate. A visually convincing explanation may still be wrong; inspect the cited region yourself.

## Human review UI

```sh
npm run poster:review -- --results /absolute/path/results/results.json --images /absolute/path/inputs --out /absolute/path/human-review
npm run test:poster-review
```

Open `http://127.0.0.1:8793/review.html`. The UI uses only the real posters from the saved trial; synthetic controls are excluded because they do not support all three criteria. It shows references, the original brief, zoomable images, optional notes, and independent pass/fail choices. **Compare assessed** becomes available after at least one poster has all three human ratings. It reveals only completed posters and shows overall/per-criterion agreement and false accepts/rejects for that subset. Unrated and partially rated posters remain editable and are excluded entirely from comparison details, explanations, metrics and exported comparison data. Use **Continue reviewing** to return to the next unfinished poster, or **Inspect poster** to examine a compared image. Compare again as more posters are assessed. Finishing every poster also sets the final completion timestamp. Prior exposure in chat cannot be undone, so this should not be described as an independently blinded study.

For faster review, every unsaved criterion is visibly selected as Pass by default. Override failures and use **Save & next** to confirm the displayed poster; the final poster has **Save assessment**. Choosing an explicit rating also confirms that poster, filling only missing criteria with Pass and preserving existing failures. Merely opening a poster, changing reference views, using Previous, or jumping with the selector does not count its defaults as reviewed. Unvisited posters never enter metrics automatically.

The revised UI requires `poster-judge-v3` evaluation results. Review format v3 and the dataset fingerprint prevent silently importing ratings from another rubric. `rubricMigration.mjs` provides the explicit four-to-three migration, preserving reveal history and partial ratings without inventing combined scores. Keep previous results and human ratings in their original folders; use new output folders for the revised evaluation and review.

The server binds only to loopback and saves `human-ratings.json` in the output folder with atomic writes. Concurrent stale writes are rejected; completed and previously revealed ratings remain editable. Each save archives the previous successful state in `ratings-history/` and records changed criteria/notes with an `afterReveal` flag. Comparison metrics and exports use the latest ratings, while original revisions remain recoverable. No network API/model calls are made and no images are published. The review stores images as content-addressed PNGs under `images/`, deduplicates shared references, and loads only the currently viewed images so larger labs stay responsive. Keep `review.html` together with its `images/` folder when moving the lab. It also works offline with browser storage; Export/Import preserves ratings across browsers. Browser-only saves do not automatically synchronize back to the server. Export before switching between offline and server modes. The local server file is authoritative when reopening through localhost.

`--port` changes the local port; `--build-only` writes HTML without starting a server. `?practice=1` isolates UI testing in a separate browser-storage key and never writes the real ratings file. Uncertain, not-applicable and errored judge responses are reported separately and excluded from binary agreement; unrated human criteria never count as passes or failures.

To append cases under the same rubric, combine prior results unchanged with the new evaluations, choose a new output directory, and pass `--extend-from /previous/review.html`. The builder verifies that existing images, briefs and judge verdicts are identical. It carries forward saved ratings and notes from the previous local JSON file, or from the previous browser-storage key when needed. Previously revealed labels remain editable, new posters stay unrated, and the final comparison includes a new-posters-only subtotal. The original lab and ratings remain intact.

For a fresh VLM run under the same rubric, evaluate all cases again using the current prompt, give the combined result file a unique `runId`, and build into a new directory with `--replace-judge-from /previous/review.html`. The builder verifies that the posters, images, references, briefs and rubric are identical while allowing the judge verdicts to change. It carries human ratings, notes and reveal history over without deriving any human answers from the fresh VLM output. Existing result and rating files remain in the previous lab directory. The unique run ID keeps separate executions distinct even when their request bodies have identical hashes.

### Review disagreements and calibrate preferences

Select **Review disagreements** in the local review lab. The queue contains criterion-level differences only for revealed posters, with filters for criterion, judge pass/fail direction, and pending/reviewed status. Schematic references open first; images support zoom and alternate references.

Use **Your rating · edit** Pass/Fail buttons to correct a mistaken human rating immediately without supplying an explanation. The original disagreement remains available, and any unsaved feedback draft stays in the form.

Record the decisive visual evidence, choose whether to keep the human rating, accept the judge, or leave the case unsure, and optionally propose a general pass/fail rule. Accepting the judge changes the human rating only on explicit save. Original disagreement snapshots remain in `review.feedback` in `human-ratings.json`; rating and feedback revisions use the existing autosave/history mechanism. Feedback becomes stale if the current human label or judge verdict changes. Unsure or stale feedback is excluded from calibration exports.

**Export calibration feedback** downloads reviewed examples, proposed rules, image paths, generation briefs, and judge explanations. Image paths are relative to the lab folder. The export does not alter the judge prompt or trigger API requests. Use it to revise the rubric and choose contrasting pass/fail examples, then freeze the adjudicated labels and compare judge versions. Keep agreeing examples as regression checks. Validate on unseen route families rather than a random split of style variants from the same route. Changes to human labels alone are not model improvements.

The **Review summary** view (`review.html#summary`) reports adjudication completion, kept versus corrected human assessments, decisions by criterion, selected reason categories, current judge agreement, and saved calibration rules with source links. It includes filterable case rationales, original notes, judge explanations, and links back to the images. Counts exclude unrevealed cases; stale or unsure feedback stays pending. Human corrections are reported separately from changes to the judge, and the summary does not re-run or modify the model.

### Re-run an approved rubric against frozen labels

`node --import tsx scripts/poster-rejudge.mts --source <baseline-results.json> --lab <human-review-folder> --rubric docs/poster-judge-rubric-v4-draft.md --out <new-run-folder> --concurrency 4`

The command snapshots human ratings and the baseline dataset, extracts only rubric instructions (excluding the provenance and interpretation notes), and sends the same posters, references and generation briefs to the same model. It records the exact prompt, its SHA-256 hash, run metadata and incremental results. Human feedback/labels are withheld from individual requests. The existing v3 schema identifier is retained because output fields are unchanged; `promptVersion` identifies the rubric version extracted from the selected document (for example `poster-rubric-v5`). The default judge prompt stays unchanged.

`node --import tsx scripts/poster-judge-comparison.mts --run <new-run-folder> --lab <human-review-folder>` builds `report.html` and `comparison.json` against the frozen labels. Both agreement and binary coverage are reported, with fixes and regressions. These results measure calibration on previously reviewed examples, not held-out accuracy.

### Annotate visual geography failures

The rubric comparison links to `annotate.html`, containing cases where the frozen human geography label is Fail and the updated judge label is Pass. Choose a region label (A–Z), click vertices to trace matching polylines on the poster and schematic or satellite reference, and describe the difference. The enlarged view edits the same regions; Undo reverses edits. Draft work autosaves separately to `geography-annotations.json`, with optimistic revisions and prior snapshots in `annotation-history/`. It does not modify images, ratings, judge results, or send requests to a model.

Polylines use normalized vertex coordinates relative to each complete source image. Three or more vertices automatically form a closed outline, including during drawing and in PNG exports; two vertices remain an open line. Export metadata records this closure rule. Double-click or Finish line saves a trace; Undo point removes its last vertex, Enter finishes and Escape cancels. For a regional issue, ready examples require a poster line, at least one reference line, and a nonempty explanation. Select **Comment applies to → Full poster** for general feedback; these issues use `scope: full_poster` and require only an explanation. Existing geometry is preserved when switching scope but is hidden and ignored for full-poster comments. JSON exports retain this scope so teaching prompts can distinguish global comments from localized evidence. Version 1 rectangles migrate to closed five-point outlines in version 2, preserving explanations and readiness. Export all annotations downloads JSON with source image paths, comments, paired polylines and readiness. Download annotated poster/reference PNG renders the visible lines and labels at source-image resolution. `?practice=1` isolates browser QA from real annotation storage.

Tests: `node --test scripts/poster-annotations/core.test.mjs`.

## Reusable workflow commands

All output paths below should be outside the checkout (for example, a private folder under `/tmp`). Do not commit generated images, account metadata, ratings, teaching packs or reports. Use `npm run test:poster-evaluation` to run all focused tests without calling a provider or querying account databases.

### Human-only review of new candidates

```sh
npm run poster:review -- --manifest /private/pool/manifest.json --images /private/pool --out /private/pool/lab --port 8795
```

A manifest has the same `cases` shape as the trial manifest above; it needs no judge results. The builder marks this as human-only, hides comparison/reveal controls, starts with zero confirmed ratings and saves human assessments independently. The manifest content fingerprints the dataset so rebuilding it does not silently change its identity.

### Teaching examples and prompt preview

Select examples explicitly in a local JSON file:

```json
{"examples":[{"id":"poster-failure-1","expectedVerdict":"fail"},{"id":"poster-pass-1","expectedVerdict":"pass"}]}
```

```sh
npm run poster:teaching -- --run /private/calibration-run --test /private/new-pool --selection /private/examples.json
npm run poster:prompts -- --run /private/calibration-run
npm run poster:lab -- --dir /private/calibration-run --port 8794
```

Teaching preparation requires completed human test ratings and ready annotations for selected failures. It rejects teaching/test poster overlap, freezes test labels by saved revision, produces annotated image copies and preserves the source images. Pass labels come from saved human ratings; their generated explanatory text is marked as a draft. The preview shows exact shared rubric text and the image/message sequence. It uses `candidate-prompt.txt` when present, otherwise the saved run's `prompt.txt`. Keep historical tested prompts unchanged and write new rubric candidates separately.

`poster-fewshot.mts` builds a conversation with geography-only teaching responses ahead of the final unannotated target. It rejects a target that appears in teaching examples. `posterJudge.mts` also supports explicit `teachingMessages` when running prepared experiments; the default judge remains rubric-only.

An alternative localized-failure pack includes original and marked images together. This workflow is intentionally negative-only, so report false rejections as well as failures caught:

```sh
node --import tsx scripts/poster-fewshot-pack.mts --run /private/calibration-run --out /private/pack --selection /private/localized-selection.json
node --import tsx scripts/poster-fewshot-run.mts --pack /private/pack --baseline /private/calibration-run --out /private/fewshot-results --dry-run
```

The localized selection file uses `{"ids":["poster-failure-1"]}`. The runner excludes all selected teaching posters from scored cases, validates image hashes, checkpoints results, and supports explicit `--retry-failed`. It calls the provider only when `--dry-run` is absent. Its HTTP/1.1 curl transport is for environments with HTTP/2 stream failures; credentials are supplied through stdin, never command arguments, and temporary request files are removed afterward.

### Preparing a candidate pool from authorized local accounts

```sh
node --import tsx scripts/prepare-poster-evaluation-pool.mts --baseline /private/calibration-run/results.json --out /private/new-pool --inventory-only
```

Run only after account owners authorize using their images and route details for evaluation. This opt-in utility uses a read-only connection to a **local** PostgreSQL database and reads published poster metadata across its accounts. Without `--inventory-only`, it selects up to six style-diverse posters for each previously unevaluated activity and reads their existing images/references from local storage or configured R2. It does not generate images, modify accounts or call a judge. Inventory account identifiers are pseudonymized. Activity IDs are preliminary route groups, not proof of geographic independence; check overlapping or duplicated activities before treating the pool as an independent test set.

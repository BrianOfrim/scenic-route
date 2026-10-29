import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import sharp from "sharp";
import { judgeCase, type TrialCase } from "./posterJudge.mts";
import { validateReview } from "./poster-review/core.mjs";

config({ path: ".env.local", quiet: true });
const { values } = parseArgs({
  options: {
    source: { type: "string" },
    lab: { type: "string" },
    rubric: { type: "string" },
    out: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "dry-run": { type: "boolean" },
    "retry-failed": { type: "boolean" },
  },
});
if (!values.source || !values.lab || !values.rubric || !values.out)
  throw new Error(
    "Provide --source results.json --lab existing-lab --rubric draft.md --out new-directory",
  );
const sourcePath = path.resolve(values.source),
  lab = path.resolve(values.lab),
  out = path.resolve(values.out);
const concurrency = Number(values.concurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("Concurrency must be 1–8");
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const html = await fs.readFile(path.join(lab, "review.html"), "utf8");
const dataset = JSON.parse(
  html.match(
    /<script type="application\/json" id="dataset">([\s\S]*?)<\/script>/,
  )![1],
);
const human = JSON.parse(
  await fs.readFile(path.join(lab, "human-ratings.json"), "utf8"),
);
validateReview(human.review, dataset);
const draft = await fs.readFile(values.rubric, "utf8");
const start = draft.indexOf("## Shared grading instructions"),
  end = draft.indexOf("## Interpretation choices for review");
if (start < 0 || end <= start)
  throw new Error("Cannot extract proposed rubric instructions");
const prompt = draft
  .slice(start, end)
  .trim()
  .replace(
    " This tolerance is a proposal inferred from accepted Modernist/Bauhaus examples; see review decisions below.",
    "",
  )
  .replace("Proposed exception:", "Typography requirement:");
const items: TrialCase[] = source.results
  .filter((r: any) => r.kind === "poster")
  .map(
    (r: any) =>
      ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        candidate: path.resolve(path.dirname(sourcePath), r.candidate),
        references: r.references.map((ref: any) => ({
          role: ref.role,
          file: path.resolve(path.dirname(sourcePath), ref.file),
        })),
        brief: r.brief,
      }) as TrialCase,
  );
if (
  items.length !== dataset.cases.length ||
  items.some((r: TrialCase) => !dataset.cases.some((c: any) => c.id === r.id))
)
  throw new Error("Source and human review posters differ");
if (values["dry-run"]) {
  console.log(
    JSON.stringify({
      cases: items.length,
      model: source.model,
      concurrency,
      promptHash: createHash("sha256").update(prompt).digest("hex"),
      sendsImages: false,
    }),
  );
  process.exit(0);
}
if (!process.env.OPENROUTER_API_KEY)
  throw new Error("OPENROUTER_API_KEY unavailable");
const response = await fetch("https://openrouter.ai/api/v1/models", {
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error("Model catalog unavailable");
const catalog: any = await response.json();
const model = catalog.data?.find((m: any) => m.id === source.model);
if (
  !model?.architecture?.input_modalities?.includes("image") ||
  !model?.supported_parameters?.includes("structured_outputs")
)
  throw new Error("Configured judge lacks required image/schema capabilities");
const prior = values["retry-failed"]
  ? JSON.parse(await fs.readFile(path.join(out, "results.json"), "utf8"))
  : null;
if (
  prior &&
  (!prior.completedAt ||
    prior.model !== source.model ||
    prior.prompt !== prompt)
)
  throw new Error(
    "Retry requires a completed run with exactly the same model and prompt",
  );
if (!prior) await fs.mkdir(out, { recursive: false });
if (!prior) {
  await fs.writeFile(
    path.join(out, "human-ratings.frozen.json"),
    JSON.stringify(human, null, 2),
  );
  await fs.writeFile(
    path.join(out, "baseline-dataset.json"),
    JSON.stringify(dataset, null, 2),
  );
  await fs.copyFile(values.rubric, path.join(out, "rubric-approved.md"));
  await fs.writeFile(path.join(out, "prompt.txt"), prompt);
} else
  await fs.copyFile(
    path.join(out, "results.json"),
    path.join(
      out,
      `results.before-retry-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    ),
  );
const run = {
  version: source.version,
  promptVersion: `poster-rubric-${draft.match(/^# Poster judge rubric (v\d+)/m)?.[1] ?? "custom"}`,
  runId: `rubric-v4-${new Date().toISOString()}`,
  startedAt: new Date().toISOString(),
  completedAt: null as string | null,
  model: source.model,
  prompt,
  promptHash: createHash("sha256").update(prompt).digest("hex"),
  concurrency,
  imagePolicy: source.imagePolicy,
  baseline: sourcePath,
  frozenHumanRevision: human.revision,
  evaluationMode: "rubric-only-calibration",
  evaluationNote:
    "Fresh rubric-v4 evaluation. Human labels are frozen; this is calibration on previously reviewed posters, not held-out validation.",
  results: [] as any[],
};
if (prior)
  Object.assign(run, prior, {
    completedAt: null,
    retryStartedAt: new Date().toISOString(),
    retryConcurrency: concurrency,
  });
const results = prior
  ? items.map((item) => prior.results.find((r: any) => r.id === item.id))
  : new Array(items.length);
let cursor = 0,
  complete = prior
    ? results.filter((r: any) => r?.result && !r.error).length
    : 0,
  writes = Promise.resolve();
const cache = new Map<string, Promise<string>>();
function image(file: string) {
  if (!cache.has(file))
    cache.set(
      file,
      sharp(file)
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
        .then((bytes) => `data:image/png;base64,${bytes.toString("base64")}`),
    );
  return cache.get(file)!;
}
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++,
        item = items[index];
      if (prior && results[index]?.result && !results[index]?.error) continue;
      try {
        const images = await Promise.all(
          [item.candidate, ...item.references.map((r) => r.file)].map(image),
        );
        results[index] = {
          ...item,
          result: await judgeCase(item, images, {
            model: source.model,
            key: process.env.OPENROUTER_API_KEY!,
            prompt,
          }),
        };
      } catch (error) {
        results[index] = {
          ...item,
          error:
            error instanceof Error
              ? `${error.message}${(error.cause as any)?.code ? ` (${(error.cause as any).code})` : ""}`
              : "Evaluation failed",
        };
      }
      complete++;
      console.log(
        JSON.stringify({
          complete,
          total: items.length,
          id: item.id,
          error: results[index].error ?? null,
          costUsd: results[index].result?.costUsd ?? null,
        }),
      );
      const snapshot = JSON.stringify(
        { ...run, results: results.filter(Boolean) },
        null,
        2,
      );
      writes = writes.then(async () => {
        await fs.writeFile(path.join(out, "results.json.tmp"), snapshot);
        await fs.rename(
          path.join(out, "results.json.tmp"),
          path.join(out, "results.json"),
        );
      });
      await writes;
    }
  }),
);
run.results = results;
run.completedAt = new Date().toISOString();
await fs.writeFile(
  path.join(out, "results.json"),
  JSON.stringify(run, null, 2),
);
console.log(
  JSON.stringify({
    finished: true,
    count: results.length,
    errors: results.filter((r) => r.error).length,
    costUsd: results.reduce((s, r) => s + (r.result?.costUsd ?? 0), 0),
    out,
  }),
);
if (results.some((r) => r.error)) process.exitCode = 1;

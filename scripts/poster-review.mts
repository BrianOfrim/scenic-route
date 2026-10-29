import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createReviewServer } from "./poster-review/server.mjs";
import {
  RUBRIC_VERSION,
  extendReview,
  emptyReview,
  carryReviewToRejudgedDataset,
} from "./poster-review/core.mjs";

const { values } = parseArgs({
  options: {
    results: { type: "string" },
    manifest: { type: "string" },
    images: { type: "string" },
    out: { type: "string" },
    "extend-from": { type: "string" },
    "replace-judge-from": { type: "string" },
    port: { type: "string", default: "8793" },
    "build-only": { type: "boolean" },
  },
});
if (values["extend-from"] && values["replace-judge-from"])
  throw new Error("Choose either expansion or judge replacement");
const previousReviewPath =
  values["extend-from"] ?? values["replace-judge-from"];
if (values.results && values.manifest)
  throw new Error("Choose either --results or --manifest");
if ((!values.results && !values.manifest) || !values.images || !values.out)
  throw new Error(
    "Usage: npm run poster:review -- (--results results.json | --manifest manifest.json) --images /input/folder --out /output/folder [--port 8793] [--build-only]",
  );
const inputText = await fs.readFile(
  path.resolve(values.results ?? values.manifest!),
  "utf8",
);
const input = JSON.parse(inputText);
const run = values.manifest
  ? {
      version: RUBRIC_VERSION,
      runId: `human-only-${createHash("sha256").update(inputText).digest("hex")}`,
      model: "Not evaluated",
      startedAt: input.createdAt ?? null,
      evaluationMode: "human-only",
      evaluationNote:
        "Human-only review. Judge evaluation has not run; these ratings stay separate from teaching examples.",
      results: input.cases,
    }
  : input;
if (!Array.isArray(run.results))
  throw new Error("Input must provide cases or evaluation results");
if (run.version !== RUBRIC_VERSION)
  throw new Error(
    `This UI requires ${RUBRIC_VERSION} judge results. Re-evaluate or explicitly migrate older results using the combined-route rule.`,
  );
const samples = run.results.filter((item: any) => item.kind === "poster");
if (!samples.length) throw new Error("No real posters in this evaluation run");
const out = path.resolve(values.out);
await fs.mkdir(path.join(out, "images"), { recursive: true });
const imageCache = new Map<string, string>();
async function imageData(file: string) {
  const input = path.resolve(values.images!, file);
  if (!imageCache.has(input)) {
    const bytes = await sharp(input)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const name = `${createHash("sha256").update(bytes).digest("hex")}.png`;
    await fs.writeFile(path.join(out, "images", name), bytes);
    imageCache.set(input, `images/${name}`);
  }
  return imageCache.get(input)!;
}
const dataset = {
  id: createHash("sha256")
    .update(
      JSON.stringify({
        rubricVersion: RUBRIC_VERSION,
        version: run.version,
        runId: run.runId,
        samples: samples.map((s: any) => [
          s.id,
          s.result?.evaluationHash ?? s.result?.requestHash,
        ]),
      }),
    )
    .digest("hex")
    .slice(0, 24),
  model: run.model,
  runAt: run.startedAt,
  judgeVersion: run.version,
  humanOnly: run.evaluationMode === "human-only",
  evaluationNote:
    run.evaluationNote ??
    (run.derivation
      ? "Three-criterion rubric: existing human and VLM route ratings were combined. Route quality passes only when both prior route checks pass; uncertainty is retained. Background and design ratings are unchanged."
      : null),
  cases: await Promise.all(
    samples.map(async (item: any) => ({
      id: item.id,
      label: item.label,
      brief: item.brief,
      candidate: await imageData(item.candidate),
      references: await Promise.all(
        item.references.map(async (r: any) => ({
          role: r.role,
          image: await imageData(r.file),
        })),
      ),
      judgment: item.result?.judgment ?? null,
      error: item.error ?? null,
    })),
  ),
};
let previousDataset: any;
if (previousReviewPath) {
  const oldHtml = await fs.readFile(path.resolve(previousReviewPath), "utf8");
  const match = oldHtml.match(
    /<script type="application\/json" id="dataset">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("Cannot read the previous review dataset");
  previousDataset = JSON.parse(match[1]);
  if (
    previousDataset.judgeVersion !== RUBRIC_VERSION ||
    previousDataset.id === dataset.id
  )
    throw new Error(
      "The new lab requires a compatible rubric and a distinct evaluation run",
    );
  if (values["replace-judge-from"]) {
    carryReviewToRejudgedDataset(
      emptyReview(previousDataset.id),
      previousDataset,
      dataset,
    );
  } else
    for (const oldCase of previousDataset.cases) {
      const nextCase = dataset.cases.find((c: any) => c.id === oldCase.id);
      const fingerprint = (src: string) =>
        src.startsWith("data:image/png;base64,")
          ? createHash("sha256")
              .update(Buffer.from(src.split(",")[1], "base64"))
              .digest("hex")
          : src.match(/^images\/([a-f0-9]{64})\.png$/)?.[1];
      const identity = (c: any) => ({
        ...c,
        candidate: fingerprint(c.candidate),
        references: c.references.map((r: any) => ({
          ...r,
          image: fingerprint(r.image),
        })),
      });
      if (
        !nextCase ||
        !fingerprint(oldCase.candidate) ||
        !fingerprint(nextCase.candidate) ||
        JSON.stringify(identity(oldCase)) !== JSON.stringify(identity(nextCase))
      )
        throw new Error(
          "Existing images, briefs and judge verdicts must remain unchanged to preserve ratings",
        );
    }
  Object.assign(dataset, {
    previous: {
      id: previousDataset.id,
      caseIds: previousDataset.cases.map((c: any) => c.id),
    },
  });
}
const here = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "poster-review",
);
const [template, core, client] = await Promise.all(
  ["template.html", "core.mjs", "client.js"].map((f) =>
    fs.readFile(path.join(here, f), "utf8"),
  ),
);
const html = template
  .replace("__DATA__", () => JSON.stringify(dataset).replaceAll("<", "\\u003c"))
  .replace("__LOGIC__", () => core.replace(/^export /gm, "") + "\n" + client);
const htmlPath = path.join(out, "review.html");
await fs.writeFile(htmlPath, html);
console.log(`Review: ${htmlPath}`);
if (!values["build-only"]) {
  const port = Number(values.port);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid port");
  const ratingsPath = path.join(out, "human-ratings.json");
  if (previousDataset) {
    let exists = true;
    try {
      await fs.access(ratingsPath);
    } catch (error: any) {
      if (error.code === "ENOENT") exists = false;
      else throw error;
    }
    if (!exists) {
      let prior;
      try {
        prior = JSON.parse(
          await fs.readFile(
            path.join(
              path.dirname(path.resolve(previousReviewPath!)),
              "human-ratings.json",
            ),
            "utf8",
          ),
        );
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (prior)
        await fs.writeFile(
          ratingsPath,
          JSON.stringify(
            {
              revision: 0,
              review: values["replace-judge-from"]
                ? carryReviewToRejudgedDataset(
                    prior.review,
                    previousDataset,
                    dataset,
                  )
                : extendReview(prior.review, previousDataset, dataset),
              everRevealedCaseIds:
                prior.everRevealedCaseIds ??
                prior.review.previouslyRevealedCaseIds ??
                [],
              copiedFrom: {
                datasetId: previousDataset.id,
                revision: prior.revision,
                reason: values["replace-judge-from"]
                  ? "fresh-judge-evaluation"
                  : "lab-expansion",
              },
            },
            null,
            2,
          ),
        );
    }
  }
  const server = await createReviewServer({ dataset, htmlPath, ratingsPath });
  server.on("error", (error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Open http://127.0.0.1:${port}/review.html — ratings save to ${path.join(out, "human-ratings.json")}`,
    ),
  );
}

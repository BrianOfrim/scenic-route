import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import os from "node:os";
import { config } from "dotenv";
import sharp from "sharp";
import { judgeCase, type TrialCase } from "./posterJudge.mts";

config({ path: ".env.local", quiet: true });
// curl provides explicit HTTP/1.1 control when the host fetch transport resets
// HTTP/2 streams. Credentials go through stdin, never command-line arguments.
const http1Fetch: typeof fetch = async (url, init) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "poster-judge-http1-"));
  try {
    const requestFile = path.join(temp, "request.json");
    const responseFile = path.join(temp, "response.json");
    await fs.writeFile(requestFile, String(init?.body ?? ""), { mode: 0o600 });
    const quote = (s: string) =>
      '"' +
      s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "") +
      '"';
    const configText = [
      `url = ${quote(String(url))}`,
      'request = "POST"',
      ...Object.entries(init?.headers ?? {}).map(
        ([key, value]) => `header = ${quote(key + ": " + value)}`,
      ),
      `data-binary = ${quote("@" + requestFile)}`,
      `output = ${quote(responseFile)}`,
    ].join("\n");
    const status = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "curl",
        [
          "--http1.1",
          "--silent",
          "--show-error",
          "--max-time",
          "300",
          "--write-out",
          "%{http_code}",
          "--config",
          "-",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      // Do not expose request headers or provider response text in error logs.
      child.stderr.on("data", () => {});
      child.on("error", () =>
        reject(new Error("HTTP/1.1 transport could not start")),
      );
      child.on("close", (code) =>
        code === 0
          ? resolve(output)
          : reject(new Error(`HTTP/1.1 transport failed (curl ${code})`)),
      );
      child.stdin.end(configText);
    });
    return new Response(await fs.readFile(responseFile), {
      status: Number(status),
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
};
const { values } = parseArgs({
  options: {
    pack: { type: "string" },
    baseline: { type: "string" },
    out: { type: "string" },
    concurrency: { type: "string", default: "3" },
    "dry-run": { type: "boolean" },
    "retry-failed": { type: "boolean" },
  },
});
if (!values.pack || !values.baseline || !values.out)
  throw new Error(
    "Provide --pack few-shot-directory --baseline rubric-v4-directory --out new-directory",
  );
const pack = path.resolve(values.pack),
  baseline = path.resolve(values.baseline),
  out = path.resolve(values.out);
const concurrency = Number(values.concurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("Concurrency must be 1–8");
const [manifest, template, comparison, baselineRun] = await Promise.all(
  [
    path.join(pack, "manifest.json"),
    path.join(pack, "messages.template.json"),
    path.join(baseline, "comparison.json"),
    path.join(baseline, "results.json"),
  ].map(async (f) => JSON.parse(await fs.readFile(f, "utf8"))),
);
const excluded = new Set(manifest.examples.map((e: any) => e.id));
const cases = comparison.cases.filter((c: any) => !excluded.has(c.id));
const items: TrialCase[] = cases.map((c: any) => ({
  id: c.id,
  label: c.label,
  kind: "poster",
  candidate: path.join(baseline, c.candidate),
  references: c.references.map((r: any) => ({
    role: r.role,
    file: path.join(baseline, r.image),
  })),
  brief: c.brief,
}));
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const prompt =
  template[0].content +
  '\n\nThe final candidate message is the NEW TARGET, even when its task field is simply "poster".';
const trainingTemplate = template.slice(1, -1);
if (trainingTemplate.length !== manifest.examples.length * 2)
  throw new Error("Incomplete teaching messages");
for (const example of manifest.examples)
  for (const image of example.attachments) {
    if (hash(await fs.readFile(path.join(pack, image.file))) !== image.sha256)
      throw new Error("Teaching image hash mismatch");
  }
if (values["dry-run"]) {
  console.log(
    JSON.stringify({
      cases: items.length,
      teachingExamples: excluded.size,
      model: manifest.model,
      concurrency,
      sendsImages: false,
    }),
  );
  process.exit(0);
}
if (!process.env.OPENROUTER_API_KEY)
  throw new Error("OPENROUTER_API_KEY unavailable");
const teachingMessages = await Promise.all(
  trainingTemplate.map(async (m: any) => ({
    ...m,
    content: Array.isArray(m.content)
      ? await Promise.all(
          m.content.map(async (part: any) => {
            if (part.type !== "image_file") return part;
            // High-quality JPEG keeps the marked image dimensions while avoiding ~55 MB
            // of repeated base64 PNG uploads on every request.
            const bytes = await sharp(path.join(pack, part.file))
              .flatten({ background: "#ffffff" })
              .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
              .toBuffer();
            return {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
                detail: "high",
              },
            };
          }),
        )
      : m.content,
  })),
);
if (
  JSON.stringify(teachingMessages).includes("target_placeholder") ||
  JSON.stringify(teachingMessages).includes("image_file")
)
  throw new Error("Unresolved message template");
const experimentHash = hash(
  JSON.stringify({ prompt, teachingMessages, model: manifest.model }),
);
const prior = values["retry-failed"]
  ? JSON.parse(await fs.readFile(path.join(out, "results.json"), "utf8"))
  : null;
if (prior && (!prior.completedAt || prior.experimentHash !== experimentHash))
  throw new Error("Retry requires the same completed experiment");
if (!prior) {
  await fs.mkdir(out, { recursive: false });
  await fs.copyFile(
    path.join(baseline, "human-ratings.frozen.json"),
    path.join(out, "human-ratings.frozen.json"),
  );
  const old = JSON.parse(
    await fs.readFile(path.join(baseline, "baseline-dataset.json"), "utf8"),
  );
  old.cases = cases.map((c: any) => ({ ...c, judgment: c.newJudgment }));
  await fs.writeFile(
    path.join(out, "baseline-dataset.json"),
    JSON.stringify(old, null, 2),
  );
  await fs.writeFile(path.join(out, "prompt.txt"), prompt);
  await fs.cp(pack, path.join(out, "teaching-pack"), { recursive: true });
} else
  await fs.copyFile(
    path.join(out, "results.json"),
    path.join(out, `results.before-retry-${Date.now()}.json`),
  );
const run = prior ?? {
  version: baselineRun.version,
  promptVersion: "poster-geography-fewshot-v1",
  startedAt: new Date().toISOString(),
  completedAt: null,
  model: manifest.model,
  prompt,
  experimentHash,
  concurrency,
  teachingExampleIds: [...excluded],
  teachingAnnotationRevision: manifest.annotationRevision,
  frozenHumanRevision: comparison.frozenRevision,
  imagePolicy: baselineRun.imagePolicy,
  baseline,
  evaluationMode: "few-shot-calibration",
  transport: "curl HTTP/1.1",
  teachingImageTransport:
    "JPEG quality 95, 4:4:4, original prepared dimensions; target images remain baseline PNG policy",
  evaluationNote: `${items.length} previously rated posters; ${excluded.size} teaching posters excluded. Related routes may occur in teaching and evaluation, so this is calibration rather than held-out route validation.`,
  results: [],
};
run.completedAt = null;
const results: any[] = prior
  ? items.map((i) => prior.results.find((r: any) => r.id === i.id))
  : new Array(items.length);
const imageCache = new Map<string, Promise<string>>();
function image(file: string) {
  if (!imageCache.has(file))
    imageCache.set(
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
        .then((b) => `data:image/png;base64,${b.toString("base64")}`),
    );
  return imageCache.get(file)!;
}
let cursor = 0,
  completed = results.filter((r) => r?.result && !r.error).length,
  writes = Promise.resolve();
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
            model: manifest.model,
            key: process.env.OPENROUTER_API_KEY!,
            prompt,
            teachingMessages,
            fetcher: http1Fetch,
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
      completed++;
      console.log(
        JSON.stringify({
          completed,
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

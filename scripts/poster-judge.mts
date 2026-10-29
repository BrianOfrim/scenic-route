import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import sharp from "sharp";
import {
  JUDGE_VERSION,
  JUDGE_PROMPT,
  judgeCase,
  type TrialCase,
} from "./posterJudge.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env.local"), quiet: true });
config({ path: path.join(root, ".env"), quiet: true });
const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    out: { type: "string" },
    model: { type: "string" },
    "dry-run": { type: "boolean" },
    "report-only": { type: "boolean" },
    "no-report": { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help || !values.manifest) {
  console.log(
    "Usage: npm run poster:judge -- --manifest /absolute/manifest.json [--out /output/folder] [--model provider/model] [--dry-run | --report-only]",
  );
  process.exit(values.help ? 0 : 1);
}
const manifestPath = path.resolve(values.manifest);
const base = path.dirname(manifestPath);
const model =
  values.model ??
  process.env.OPENROUTER_JUDGE_MODEL ??
  process.env.OPENROUTER_MODEL;
if (!model) throw new Error("Set OPENROUTER_JUDGE_MODEL or pass --model");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (
  !Array.isArray(manifest.cases) ||
  manifest.cases.length < 1 ||
  manifest.cases.length > 20
)
  throw new Error("Provide 1–20 explicit cases per trial");
const cases: TrialCase[] = manifest.cases;
const ids = new Set<string>();
for (const c of cases) {
  if (
    !c ||
    typeof c.id !== "string" ||
    !/^[\w-]+$/.test(c.id) ||
    ids.has(c.id) ||
    !["poster", "shape-control"].includes(c.kind) ||
    typeof c.label !== "string" ||
    typeof c.candidate !== "string" ||
    !Array.isArray(c.references) ||
    !c.references.length ||
    c.references.length > 4 ||
    c.references.some(
      (r) => !r || typeof r.file !== "string" || typeof r.role !== "string",
    ) ||
    (c.expectedRouteVerdict != null &&
      !["pass", "fail"].includes(c.expectedRouteVerdict))
  )
    throw new Error("Invalid or duplicate manifest case");
  ids.add(c.id);
  for (const file of [c.candidate, ...c.references.map((r) => r.file)])
    await fs.access(path.resolve(base, file));
}
const out = path.resolve(
  values.out ??
    path.join(
      base,
      `results-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    ),
);
if (values["report-only"] && !values.out)
  throw new Error("--report-only requires --out pointing to existing results");
if (values["dry-run"]) {
  console.log(
    JSON.stringify(
      {
        model,
        cases: cases.length,
        expectedRequests: cases.length,
        out,
        sendsImages: false,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const key = process.env.OPENROUTER_API_KEY;
if (!values["report-only"]) {
  if (!key) throw new Error("Set OPENROUTER_API_KEY");
  const modelResponse = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(20_000),
  });
  if (!modelResponse.ok)
    throw new Error(`Model catalog unavailable: ${modelResponse.status}`);
  const catalog = (await modelResponse.json()) as any;
  const info = catalog.data?.find((m: any) => m.id === model);
  if (
    !info?.architecture?.input_modalities?.includes("image") ||
    !info?.architecture?.output_modalities?.includes("text")
  )
    throw new Error("Judge must support image input and text output");
  if (!info.supported_parameters?.includes("structured_outputs"))
    throw new Error("Judge must support structured outputs");
}
await fs.mkdir(out, { recursive: true });
const run = {
  version: JUDGE_VERSION,
  startedAt: new Date().toISOString(),
  model,
  prompt: JUDGE_PROMPT,
  imagePolicy:
    "PNG; max edge 2048 px; preserve aspect ratio; no enlargement; high detail",
  results: [] as any[],
};
if (values["report-only"])
  Object.assign(
    run,
    JSON.parse(await fs.readFile(path.join(out, "results.json"), "utf8")),
  );
const previews = new Map<string, string>();
async function imageData(file: string) {
  const resolved = path.resolve(base, file);
  if (!previews.has(resolved)) {
    const image = await sharp(resolved)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    previews.set(resolved, `data:image/png;base64,${image.toString("base64")}`);
  }
  return previews.get(resolved)!;
}
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function report() {
  const controls = run.results.filter((r) => r.expectedRouteVerdict);
  const correct = controls.filter(
    (r) => r.result?.judgment.route_quality.verdict === r.expectedRouteVerdict,
  ).length;
  const cost = run.results.reduce(
    (sum, r) => sum + (r.result?.costUsd ?? 0),
    0,
  );
  const unknownCost = run.results.some(
    (r) => r.error || r.result?.costUsd == null,
  );
  const ordered = [...run.results].sort(
    (a, b) =>
      Number(a.kind === "shape-control") - Number(b.kind === "shape-control"),
  );
  const sections = await Promise.all(
    ordered.map(async (r) => {
      const images = [r.candidate, ...r.references.map((ref: any) => ref.file)];
      const figures = await Promise.all(
        images.map(
          async (file, i) =>
            `<figure><figcaption>${esc(i === 0 ? "Candidate" : r.references[i - 1].role)}</figcaption><button class="zoom" type="button" aria-label="Enlarge ${esc(i === 0 ? "candidate" : "reference")}"><img src="${await imageData(file)}" alt="${esc(i === 0 ? "Candidate" : "Reference")}" /></button></figure>`,
        ),
      );
      return `<section><h2>${esc(r.label)}</h2><p class="meta">${esc(r.id)} · ${esc(r.kind)}${r.expectedRouteVerdict ? ` · Known route answer: <b>${esc(r.expectedRouteVerdict)}</b>` : " · Human route label: not yet supplied"}</p>
      <div class="images">${figures.join("")}</div>${
        r.error
          ? `<p class="fail">Evaluation error: ${esc(r.error)}</p>`
          : Object.entries(r.result.judgment)
              .map(
                ([dimension, a]: [string, any]) =>
                  `<details ${dimension === "route_quality" ? "open" : ""}><summary>${esc(dimension)} <b class="${esc(a.verdict)}">${esc(a.verdict.replaceAll("_", " "))}</b> — ${esc(a.summary)}</summary>${a.issues.map((i: any) => `<p><b>${esc(i.location)}</b><br>Reference: ${esc(i.referenceObservation)}<br>Candidate: ${esc(i.candidateObservation)}</p>`).join("")}</details>`,
              )
              .join("")
      }
      ${r.result ? `<p class="meta">${esc(r.result.model)} · ${(r.result.durationMs / 1000).toFixed(1)} s · ${r.result.costUsd == null ? "Cost unavailable" : "$" + r.result.costUsd.toFixed(5)}</p>` : ""}</section>`;
    }),
  );
  await fs.writeFile(
    path.join(out, "report.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poster judge trial</title><style>
body{font:15px/1.6 system-ui,sans-serif;color:#202c30;background:#f7f6f1;max-width:1400px;margin:0 auto;padding:32px}h1{font-size:28px;margin-bottom:8px}h2{font-size:21px}p{max-width:1000px}.meta{font-size:13px;color:#59656b}section{border-top:1px solid #bec7c7;padding:24px 0;margin-top:24px}.images{display:flex;gap:20px;align-items:start;overflow-x:auto}figure{margin:0;flex:1;min-width:240px}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;max-height:680px;object-fit:contain;background:white}details{padding:10px 0;border-bottom:1px solid #ddd}summary{cursor:pointer}summary b{padding:2px 6px;margin:0 8px}.pass{color:#166343}.fail{color:#a02222}.uncertain{color:#835300}.not_applicable{color:#59656b}details p{margin-left:20px}
.images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible}figure{min-width:0}figcaption{font-size:13px}.zoom{border:0;background:none;padding:0;width:100%;cursor:zoom-in}dialog{max-width:95vw;max-height:95vh;padding:16px;border:1px solid #59656b}dialog img{max-height:none;width:auto;max-width:85vw}dialog button{display:block;margin:0 0 12px auto;padding:8px 16px}dialog::backdrop{background:#0009}@media(min-width:1000px){.images{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}}
</style><h1>Poster judge: first trial</h1><p><b>${correct}/${controls.length} labeled controls matched their known answer.</b> ${run.results.filter((r) => r.kind === "poster").length} real posters reviewed. Reported request cost: $${cost.toFixed(5)}${unknownCost ? " (incomplete; some costs unavailable)" : ""}.</p><p>This is a small feasibility test, not a calibrated accuracy estimate. Real-poster verdicts are model opinions awaiting human review. A pass means no material mismatch was identified, not proof of an exact trace. Control labels were withheld from the judge. Synthetic controls test isolated shape perception and do not establish reliability on illustrated posters.</p><p class="meta">${esc(run.startedAt)} · ${esc(run.model)} · ${esc(run.version)} · ${esc(run.imagePolicy)}. Click images to inspect; expand assessments for evidence.</p>${sections.join("")}<dialog><button type="button">Close image</button><img alt="Enlarged evaluation image"></dialog><script>const dialog=document.querySelector('dialog');document.querySelectorAll('.zoom').forEach(button=>button.addEventListener('click',()=>{dialog.querySelector('img').src=button.querySelector('img').src;dialog.showModal()}));dialog.querySelector('button').addEventListener('click',()=>dialog.close());</script></html>`,
  );
}
for (const item of values["report-only"] ? [] : cases) {
  console.log(`Judging ${item.id} (${run.results.length + 1}/${cases.length})`);
  const images = await Promise.all(
    [item.candidate, ...item.references.map((r) => r.file)].map(imageData),
  );
  let entry;
  try {
    const result = await judgeCase(item, images, { model, key: key! });
    entry = { ...item, result };
    console.log(
      JSON.stringify({
        id: item.id,
        route: result.judgment.route_quality.verdict,
        costUsd: result.costUsd,
      }),
    );
  } catch (error) {
    entry = {
      ...item,
      error: error instanceof Error ? error.message : "Judge failed",
    };
    console.error(entry.error);
    process.exitCode = 1;
  }
  run.results.push(entry);
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(run, null, 2),
  );
  if (!values["no-report"]) await report();
}
if (values["report-only"]) await report();
console.log(
  values["no-report"]
    ? `Results: ${path.join(out, "results.json")}`
    : `Report: ${path.join(out, "report.html")}`,
);

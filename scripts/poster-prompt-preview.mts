import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { judgeMessages, JUDGE_SCHEMA } from "./posterJudge.mts";
import { fewShotJudgeMessages } from "./poster-fewshot.mts";
const { values } = parseArgs({ options: { run: { type: "string" } } });
if (!values.run) throw new Error("Provide --run directory");
const dir = path.resolve(values.run);
let promptFile = "candidate-prompt.txt";
try {
  await fs.access(path.join(dir, promptFile));
} catch {
  promptFile = "prompt.txt";
}
const base = await fs.readFile(path.join(dir, promptFile), "utf8"),
  teaching = JSON.parse(
    await fs.readFile(path.join(dir, "teaching-set.json"), "utf8"),
  );
const rubricName =
  promptFile === "candidate-prompt.txt"
    ? "v5 (exact endpoint verification)"
    : "v4";
const target = {
  id: "unseen-target-placeholder",
  label: "withheld",
  kind: "poster" as const,
  candidate: "<target-poster>",
  references: [
    { role: "route-only", file: "<route-only>" },
    { role: "schematic", file: "<schematic>" },
    { role: "satellite", file: "<satellite>" },
  ],
  brief: {
    placeholder:
      "The target poster’s saved generation brief; no human ratings or review notes.",
  },
};
const urls = [
  "<TARGET_POSTER_IMAGE>",
  "<TARGET_ROUTE_ONLY_IMAGE>",
  "<TARGET_SCHEMATIC_IMAGE>",
  "<TARGET_SATELLITE_IMAGE>",
];
const baseline = judgeMessages(target, urls, base),
  fewshot = fewShotJudgeMessages(
    target,
    urls,
    base,
    teaching,
    teaching.examples.map((e: any) => e.images.map((image: any) => image.file)),
  );
const blueprint = {
  status:
    "Proposed request blueprints; these displayed versions have not been run",
  rubricVersion: rubricName,
  imageHandling:
    "Relative teaching image paths below stand for high-detail image bytes encoded as data URLs at send time. Target placeholders are replaced with an unannotated poster, its saved references, and its brief. Human target ratings are withheld.",
  model: "meta/muse-spark-1.3-contributor",
  temperature: 0,
  responseSchema: JUDGE_SCHEMA,
  rubricOnly: { messages: baseline },
  fewShot: { messages: fewshot },
};
await fs.writeFile(
  path.join(dir, "prompt-versions.json"),
  JSON.stringify(blueprint, null, 2),
);
await fs.writeFile(
  path.join(dir, "fewshot-system-prompt.txt"),
  fewshot[0].content,
);
const esc = (s: any) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const msg = (m: any, i: number) =>
  `<article class="message"><h3>${i + 1}. ${esc(m.role)}</h3>${typeof m.content === "string" ? `<pre>${esc(m.content)}</pre>` : m.content.map((part: any) => (part.type === "text" ? `<pre>${esc(part.text)}</pre>` : part.image_url.url.startsWith("images/") ? `<a href="${esc(part.image_url.url)}" target="_blank"><img src="${esc(part.image_url.url)}" alt="Worked example image"><span>${esc(part.image_url.url)}</span></a>` : `<p class="placeholder">${esc(part.image_url.url)} · high detail</p>`)).join("")}</article>`;
const column = (name: string, messages: any[]) =>
  `<section class="column"><h2>${esc(name)}</h2><p class="small">${messages.length} messages · ${messages.length === 2 ? "Only the target images" : "10 teaching images plus the target images"}</p><details open><summary>Full system prompt</summary><pre class="system">${esc(messages[0].content)}</pre></details><details><summary>Full message sequence, images and teaching answers</summary>${messages
    .slice(1)
    .map((m, i) => msg(m, i + 1))
    .join("")}</details></section>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Judge prompts · Rubric vs few-shot</title><style>body{font:15px/1.5 system-ui;background:#f5f4ef;color:#23312d;margin:0}header{padding:24px 30px;background:#fffefa;border-bottom:1px solid #d4dcd5}h1{font-size:26px;margin:6px 0}h2{font-size:20px}h3{font-size:14px}main{padding:24px;max-width:1850px;margin:auto}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.column{background:#fffefa;border:1px solid #d4dcd5;border-radius:8px;padding:20px;min-width:0}pre{font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f4ef;padding:16px;border-radius:5px}pre.system{max-height:65vh;overflow:auto}summary{cursor:pointer;font-weight:600;margin:14px 0}.small{font-size:12px;color:#62716a}.notice{background:#edf2e9;padding:14px;max-width:1200px}.message{border-top:1px solid #d4dcd5;padding:12px 0}.message img{max-width:100%;max-height:440px;display:block;object-fit:contain}.message a span{font-size:10px;overflow-wrap:anywhere}a{color:#176449}.placeholder{padding:14px;background:#f2eee4;font-size:12px}@media(max-width:850px){.columns{grid-template-columns:1fr}} </style><header><p class="small">SCENIC ROUTE / JUDGE PROMPT COMPARISON</p><h1>Rubric-only versus few-shot</h1><p class="notice">Both versions use the same ${rubricName} rubric and final output schema. Both explicitly verify each endpoint against the schematic before a route-quality pass. The few-shot version adds teaching instructions and five worked examples for background geography. The displayed versions have not been sent to the judge yet.</p><p>The target message shown here is a template. Real requests substitute one unannotated test poster, its saved references and generation brief; human target ratings stay withheld. Image paths in the download are resolved to image bytes at send time.</p><a href="${promptFile}" target="_blank">Rubric-only system text</a> · <a href="fewshot-system-prompt.txt" target="_blank">Few-shot system text</a> · <a href="prompt-versions.json" target="_blank">Both complete request blueprints</a> · <a href="teaching.html">Teaching examples</a><p class="small">Shared rubric SHA-256: ${createHash("sha256").update(base).digest("hex")}</p></header><main><div class="columns">${column("A · Rubric only", baseline)}${column("B · Rubric + five visual examples", fewshot)}</div><details><summary>Shared final response schema</summary><pre>${esc(JSON.stringify(JUDGE_SCHEMA, null, 2))}</pre></details></main></html>`;
await fs.writeFile(path.join(dir, "prompts.html"), html);
console.log(
  JSON.stringify({
    baselineMessages: baseline.length,
    fewShotMessages: fewshot.length,
    preview: path.join(dir, "prompts.html"),
  }),
);

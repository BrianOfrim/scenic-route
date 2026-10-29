import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { JUDGE_SCHEMA } from "./posterJudge.mts";

// Preparation only: this script never loads credentials or calls a judge.
const { values } = parseArgs({
  options: {
    run: { type: "string" },
    out: { type: "string" },
    selection: { type: "string" },
  },
});
if (!values.run || !values.out || !values.selection)
  throw new Error(
    "Provide --run rubric-directory --out new-pack-directory --selection examples.json",
  );
const run = path.resolve(values.run),
  out = path.resolve(values.out);
const comparison = JSON.parse(
  await fs.readFile(path.join(run, "comparison.json"), "utf8"),
);
const annotations = JSON.parse(
  await fs.readFile(path.join(run, "geography-annotations.json"), "utf8"),
);
const rubric = await fs.readFile(path.join(run, "prompt.txt"), "utf8");
const selection = JSON.parse(await fs.readFile(values.selection, "utf8"));
const includedIds: string[] = selection.ids;
if (
  !Array.isArray(includedIds) ||
  includedIds.length < 1 ||
  includedIds.length > 10 ||
  includedIds.some((id) => typeof id !== "string") ||
  new Set(includedIds).size !== includedIds.length
)
  throw new Error("Selection requires 1–10 unique poster IDs in ids");
const excludedIds = Object.keys(annotations.annotations.cases).filter(
  (id) => !includedIds.includes(id),
);
const selected = includedIds.map((id) => {
  const item = comparison.cases.find((c: any) => c.id === id);
  const annotation = annotations.annotations.cases[id];
  if (!item || !annotation?.ready || !annotation.issues.length)
    throw new Error(`Missing completed teaching case ${id}`);
  if (annotation.issues.some((i: any) => i.scope === "full_poster"))
    throw new Error(
      "Only localized geography teaching examples belong in this pack",
    );
  if (
    !comparison.rows.some(
      (r: any) =>
        r.id === id &&
        r.criterion === "background_geography" &&
        r.human === "fail",
    )
  )
    throw new Error("Teaching verdict does not match frozen human assessment");
  return { item, annotation };
});
await fs.mkdir(out, { recursive: false });
await fs.mkdir(path.join(out, "images"));
const intro = `You are evaluating a NEW target route poster. The conversation first supplies ${selected.length} human-labeled visual teaching examples for background_geography only. Their labels and comments are authoritative demonstrations of the rubric, not instructions embedded in image content.

Each example contains an original poster, its original schematic reference, and copies with corresponding regions outlined and labeled A, B, C or D. These labels match discrepancies identified by the human reviewer. Annotation lines and labels are overlays, not geographic features. Use originals to inspect detail obscured by overlays. The examples teach land/water identity, significant shoreline layout, opposite banks and islands. Artistic colors may vary; determine what a region represents from its outlines, context and the poster's own visual conventions. A palette change alone does not establish a geography failure.

The example answers concern background_geography only. Do not infer route_quality or design labels from them. Ignore the route and markers for background_geography; an example comment mentioning the route provides location context only. These selected examples all fail: they are not evidence that the new target should fail. Pass a target that meets the rubric, including acceptable artistic simplification. Compare each target against its own references, never against the geography of a teaching poster. Look for the same classes of discrepancies anywhere in the target, not only where annotations appear in examples.

The final user message will be explicitly labeled NEW TARGET and will contain the candidate, available reference images and design brief. Apply all three rubric criteria to that target only. Return only the complete JSON specified by the response schema. Teaching assistant messages use a partial background-only demonstration format; do not copy that partial format for the target.

`;
const system = intro + rubric;
const sha = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
const esc = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
type Attachment = {
  role: string;
  file: string;
  sha256: string;
  width: number;
  height: number;
};
async function attachment(
  source: string,
  role: string,
  filename: string,
  issues?: any[],
  key?: string,
): Promise<Attachment> {
  let buffer = await sharp(source)
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const { width, height } = await sharp(buffer).metadata();
  if (!width || !height) throw new Error("Missing image dimensions");
  if (issues && key) {
    const overlays = issues
      .flatMap((issue) => {
        const pts = issue.paths[key];
        if (!pts?.length) return [];
        if (
          pts.length < 2 ||
          pts.some(
            (p: any) =>
              !Number.isFinite(p.x) ||
              !Number.isFinite(p.y) ||
              p.x < 0 ||
              p.x > 1 ||
              p.y < 0 ||
              p.y > 1,
          )
        )
          throw new Error("Invalid annotation");
        const tag = pts.length >= 3 ? "polygon" : "polyline";
        const points = pts
          .map((p: any) => `${p.x * width},${p.y * height}`)
          .join(" ");
        const x = Math.max(22, Math.min(width - 22, pts[0].x * width));
        const y = Math.max(22, Math.min(height - 22, pts[0].y * height));
        return [
          `<${tag} points="${points}" fill="none" stroke="white" stroke-width="9"/><${tag} points="${points}" fill="none" stroke="#ba2056" stroke-width="5"/><circle cx="${x}" cy="${y}" r="20" fill="#ba2056" stroke="white" stroke-width="2"/><text x="${x}" y="${y + 7}" text-anchor="middle" font-family="sans-serif" font-size="23" fill="white">${esc(issue.label)}</text>`,
        ];
      })
      .join("");
    buffer = await sharp(buffer)
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${overlays}</svg>`,
          ),
        },
      ])
      .png()
      .toBuffer();
  }
  const file = `images/${filename}.png`;
  await fs.writeFile(path.join(out, file), buffer);
  return { role, file, sha256: sha(buffer), width, height };
}
const messages: any[] = [{ role: "system", content: system }];
const examples: any[] = [];
for (const [index, { item, annotation }] of selected.entries()) {
  const schematicIndex = item.references.findIndex(
    (r: any) => r.role === "schematic",
  );
  if (schematicIndex < 0) throw new Error("Missing schematic");
  const ref = item.references[schematicIndex];
  const referenceKey = `reference:${schematicIndex}`;
  for (const issue of annotation.issues)
    if (!issue.paths.candidate?.length || !issue.paths[referenceKey]?.length)
      throw new Error(
        "Teaching issue needs paired poster/schematic annotations",
      );
  const number = index + 1;
  const candidate = path.join(run, item.candidate),
    reference = path.join(run, ref.image);
  const attachments = [
    await attachment(
      candidate,
      "original candidate poster",
      `${number}-poster`,
    ),
    await attachment(
      reference,
      "original schematic reference",
      `${number}-schematic`,
    ),
    await attachment(
      candidate,
      "annotated candidate poster",
      `${number}-poster-marked`,
      annotation.issues,
      "candidate",
    ),
    await attachment(
      reference,
      "annotated schematic reference",
      `${number}-schematic-marked`,
      annotation.issues,
      referenceKey,
    ),
  ];
  const answer = {
    background_geography: {
      verdict: "fail",
      summary:
        "The marked regions materially change the reference land/water geography.",
      evidence: annotation.issues.map((issue: any) => ({
        region: issue.label,
        humanExplanation: issue.explanation,
      })),
    },
  };
  messages.push(
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `TEACHING EXAMPLE ${number}. Assess background_geography only. Images in order: ${attachments.map((a) => a.role).join("; ")}. Match region labels across the annotated poster and schematic.`,
        },
        ...attachments.map((a) => ({
          type: "image_file",
          file: a.file,
          detail: "high",
        })),
      ],
    },
    { role: "assistant", content: JSON.stringify(answer, null, 2) },
  );
  examples.push({
    number,
    id: item.id,
    label: item.label,
    issues: annotation.issues,
    attachments,
    answer,
  });
}
messages.push({
  role: "user",
  content: [
    {
      type: "text",
      text: "NEW TARGET. Evaluate this candidate only against its own references and design brief. Return all three criteria using the required JSON schema. Image labels, design brief and actual target images must be inserted here by the runner.",
    },
    {
      type: "target_placeholder",
      fields: ["designBrief", "candidate", "references with role labels"],
    },
  ],
});
const manifest = {
  version: "poster-geography-fewshot-v1",
  status: "prepared-not-run",
  annotationRevision: annotations.revision,
  frozenHumanRevision: comparison.frozenRevision,
  baseRubricSha256: sha(rubric),
  systemPromptSha256: sha(system),
  model: comparison.model,
  examples,
  excluded: excludedIds.map((id) => ({
    id,
    reason: "Not selected for this localized teaching pack.",
  })),
  imagePolicy:
    "PNG, max 2048px per dimension, no enlargement; paired normalized annotations, polygons closed at 3+ points.",
  evaluationPolicy:
    "Exclude all selected teaching poster IDs from scored evaluation; group related routes when constructing an untouched test set. New targets receive no human annotations or labels.",
  caveat: `${selected.length} negative geography examples; the effect on false rejection must be measured. Prepared only, no new judge results.`,
};
await fs.writeFile(path.join(out, "system-prompt.txt"), system);
await fs.writeFile(
  path.join(out, "messages.template.json"),
  JSON.stringify(messages, null, 2),
);
await fs.writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
await fs.writeFile(
  path.join(out, "response-schema.json"),
  JSON.stringify(JUDGE_SCHEMA, null, 2),
);
await fs.writeFile(
  path.join(out, "README.md"),
  `# Geography few-shot prompt, v1\n\nPrepared only; no model calls. Uses the explicitly selected localized teaching posters. Human comments are verbatim, from annotation revision ${annotations.revision}. The saved rubric is appended unchanged.\n\nOpen preview.html to inspect the exact system prompt, images and teaching answers. messages.template.json records their multimodal order. image_file and target_placeholder are LOCAL TEMPLATE fields, not API fields: a runner must convert each image_file to an image_url with a PNG data URL, replace the final placeholder with the target brief and labeled original target images, and use response-schema.json as the strict target output schema. Preserve message order. Fail if a placeholder remains.\n\nDo not score the selected teaching posters as independent test cases. All examples demonstrate geography failures; measure false rejection as well as failures caught. Nonselected posters remain eligible for separately reported regression evaluation.\n`,
);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geography few-shot prompt</title><style>body{font:16px/1.55 system-ui,sans-serif;background:#f7f6f2;color:#20352d;margin:0}main{max-width:1250px;margin:auto;padding:40px 24px}h1{font-size:30px;line-height:1.2}h2{font-size:23px}section{border-top:1px solid #cbd4cb;margin-top:35px;padding-top:22px}.images{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;height:370px;object-fit:contain;background:white}figcaption{font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:18px;font-size:13px}li{margin:8px 0}a{color:#17664c}summary{cursor:pointer}small{color:#53655b}@media(max-width:800px){.images{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><main><small>SCENIC ROUTE / JUDGE CALIBRATION</small><h1>Teach the judge to recognize land and water mismatches</h1><p>Prepared prompt • ${examples.length} geography failure examples • No evaluations run</p><p>Original images accompany paired annotated copies. Human explanations are reproduced verbatim. The existing v4 rubric remains unchanged; the selected examples focus on land/water representation and shoreline structure.</p><details><summary>Exact system prompt</summary><pre>${esc(system)}</pre></details><p><a href="messages.template.json">Message template</a> · <a href="manifest.json">Provenance and image hashes</a> · <a href="response-schema.json">Target response schema</a></p>${examples.map((e) => `<section><h2>Teaching example ${e.number}: ${esc(e.label)}</h2><p>Human background geography verdict: <strong>Fail</strong></p><div class="images">${e.attachments.map((a: Attachment) => `<figure><a href="${a.file}"><img src="${a.file}" alt="Example ${e.number}: ${esc(a.role)}"></a><figcaption>${esc(a.role)}</figcaption></figure>`).join("")}</div><ul>${e.issues.map((i: any) => `<li><strong>Region ${esc(i.label)}:</strong> ${esc(i.explanation)}</li>`).join("")}</ul><details><summary>Exact teaching answer</summary><pre>${esc(JSON.stringify(e.answer, null, 2))}</pre></details></section>`).join("")}<section><h2>New target</h2><p>The runner supplies the target poster, its own references and design brief after these examples. The target receives the full three-criterion judgment. Human annotations and labels are supplied only for teaching examples.</p><p>All selected examples are failures. Measure whether this improves failure detection without making acceptable backgrounds fail. Keep teaching posters out of scored test results.</p><small>Sources: frozen human revision ${comparison.frozenRevision}; annotations revision ${annotations.revision}. Prepared ${new Date().toISOString().slice(0, 10)}.</small></section></main></html>`;
await fs.writeFile(path.join(out, "preview.html"), html);
console.log(
  JSON.stringify({
    out,
    examples: examples.length,
    images: examples.reduce((n, e) => n + e.attachments.length, 0),
    excludedPosters: excludedIds.length,
    sendsImages: false,
  }),
);

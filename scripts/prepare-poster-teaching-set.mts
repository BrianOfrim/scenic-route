import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import sharp from "sharp";
const { values } = parseArgs({
  options: {
    run: { type: "string" },
    test: { type: "string" },
    selection: { type: "string" },
  },
});
if (!values.run || !values.test || !values.selection)
  throw new Error(
    "Provide --run annotated-run-folder --test new-review-pool-folder --selection examples.json",
  );
const dir = path.resolve(values.run),
  test = path.resolve(values.test);
const comparison = JSON.parse(
  await fs.readFile(path.join(dir, "comparison.json"), "utf8"),
);
const saved = JSON.parse(
  await fs.readFile(path.join(dir, "geography-annotations.json"), "utf8"),
);
const testManifest = JSON.parse(
  await fs.readFile(path.join(test, "manifest.json"), "utf8"),
);
const testHuman = JSON.parse(
  await fs.readFile(path.join(test, "lab/human-ratings.json"), "utf8"),
);
if (
  testManifest.cases.some((c: any) =>
    ["route_quality", "background_geography", "design"].some(
      (k) => !testHuman.review.ratings[c.id]?.[k],
    ),
  )
)
  throw new Error("Complete all human reviews before freezing the test labels");
const frozenFile = `human-ratings.frozen-${testHuman.revision}.json`;
try {
  await fs.writeFile(
    path.join(test, frozenFile),
    JSON.stringify(testHuman, null, 2),
    { flag: "wx" },
  );
} catch (e: any) {
  if (e.code !== "EEXIST") throw e;
}
const selection = JSON.parse(await fs.readFile(values.selection, "utf8"));
const requested = selection.examples;
if (
  !Array.isArray(requested) ||
  !requested.length ||
  requested.length > 10 ||
  new Set(requested.map((e: any) => e.id)).size !== requested.length ||
  requested.some(
    (e: any) =>
      typeof e.id !== "string" || !["pass", "fail"].includes(e.expectedVerdict),
  )
)
  throw new Error(
    "Selection requires 1–10 unique examples with id and expectedVerdict",
  );
const ids = requested.map((e: any) => e.id);
const heldOut = new Set(testManifest.cases.map((c: any) => c.id));
const esc = (s: any) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function annotated(file: string, key: string, issues: any[]) {
  const relevant = issues.filter(
    (i) => i.scope !== "full_poster" && i.paths?.[key],
  );
  if (!relevant.length) return file;
  const input = await fs.readFile(path.join(dir, file)),
    meta = await sharp(input).metadata(),
    w = meta.width!,
    h = meta.height!;
  const stroke = Math.max(5, w / 180),
    font = Math.max(36, w * 0.045);
  const shapes = relevant
    .map((i) => {
      const pts = i.paths[key],
        p = pts[0],
        x = Math.min(w - font, p.x * w + stroke),
        y = Math.max(font, Math.min(h - stroke, p.y * h + font));
      return `<${pts.length >= 3 ? "polygon" : "polyline"} points="${pts.map((p: any) => `${p.x * w},${p.y * h}`).join(" ")}" fill="none" stroke="#cf2e15" stroke-width="${stroke}" stroke-linejoin="round"/><text x="${x}" y="${y}" font-family="sans-serif" font-weight="bold" font-size="${font}" fill="white" stroke="#9b2010" stroke-width="${stroke}" paint-order="stroke">${esc(i.label)}</text>`;
    })
    .join("");
  const bytes = await sharp(input)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shapes}</svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  const output = `images/${createHash("sha256").update(bytes).digest("hex")}.png`;
  await fs.writeFile(path.join(dir, output), bytes);
  return output;
}
const examples = [];
for (let n = 0; n < ids.length; n++) {
  const id = ids[n];
  if (!id || heldOut.has(id))
    throw new Error("Teaching and test posters must be disjoint");
  const item = comparison.cases.find((c: any) => c.id === id),
    expected = requested[n].expectedVerdict;
  if (
    comparison.rows.find(
      (r: any) => r.id === id && r.criterion === "background_geography",
    )?.human !== expected
  )
    throw new Error("Teaching verdict must match saved human label");
  const a = saved.annotations.cases[id];
  if (expected === "fail" && !a?.ready)
    throw new Error("Selected failure is not ready");
  const issues = expected === "fail" ? a.issues : [];
  const ref =
      item.references.find((r: any) => r.role === "schematic") ??
      item.references[0],
    index = item.references.indexOf(ref);
  examples.push({
    id,
    label: item.label,
    criterion: "background_geography",
    expectedVerdict: expected,
    explanationSource:
      expected === "fail"
        ? "user annotation"
        : "draft from accepted human label",
    explanation:
      expected === "fail"
        ? issues
            .map(
              (i: any) =>
                `${i.scope === "full_poster" ? "Whole poster" : `Region ${i.label}`}: ${i.explanation}`,
            )
            .join("\n")
        : "Human verdict: Pass. Accept the artistic rendering and simplification in this example; assess the underlying geographic layout rather than requiring photographic detail or schematic colors.",
    images: [
      {
        role: "candidate",
        file: await annotated(item.candidate, "candidate", issues),
        original: item.candidate,
      },
      {
        role: ref.role,
        file: await annotated(ref.image, `reference:${index}`, issues),
        original: ref.image,
      },
    ],
    annotations: issues,
  });
}
const teaching = {
  version: 1,
  createdAt: new Date().toISOString(),
  annotationRevision: saved.revision,
  criterion: "background_geography",
  status: "preview; not yet sent to judge",
  instructions:
    "These are worked examples for background geography only. Lettered outlines identify human annotations, not geographic features or route segments. A full-poster comment applies without a localized outline. Do not infer route-quality or design labels from these examples. Test posters are unannotated and their human labels are withheld.",
  examples,
  testSet: {
    posters: testManifest.cases.length,
    frozenHumanRevision: testHuman.revision,
    frozenHumanFile: path.join(test, frozenFile),
    teachingTestOverlap: 0,
  },
  caution:
    "Report false acceptance, false rejection and individual cases alongside agreement, especially when human labels are imbalanced.",
};
await fs.writeFile(
  path.join(dir, "teaching-set.json"),
  JSON.stringify(teaching, null, 2),
);
const cards = examples
  .map(
    (e, i) =>
      `<article><h2>${i + 1}. ${esc(e.label)}</h2><span class="badge ${e.expectedVerdict}">Background geography: ${esc(e.expectedVerdict.toUpperCase())}</span><div class="images">${e.images.map((im) => `<figure><figcaption>${esc(im.role)}</figcaption><a href="${esc(im.file)}" target="_blank"><img src="${esc(im.file)}" alt="${esc(e.label + " " + im.role)}"></a></figure>`).join("")}</div><p class="explanation">${esc(e.explanation)}</p><p class="small">${esc(e.explanationSource === "user annotation" ? "Your annotation, preserved verbatim." : "Draft explanation; the Pass verdict comes from your saved human review.")}</p></article>`,
  )
  .join("");
await fs.writeFile(
  path.join(dir, "teaching.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Few-shot teaching set · Scenic Route</title><style>body{font:15px/1.5 system-ui;background:#f5f4ef;color:#23312d;margin:0}header,main{max-width:1300px;margin:auto;padding:28px}header{border-bottom:1px solid #d4dcd5}h1{font-size:28px}h2{font-size:20px}article{background:#fffefa;border:1px solid #d4dcd5;border-radius:8px;padding:24px;margin:24px 0}.images{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}figure{margin:0}img{width:100%;max-height:650px;object-fit:contain;cursor:zoom-in}.explanation{white-space:pre-wrap;background:#edf2e9;padding:16px;border-left:3px solid #176449}.badge{display:inline-block;padding:5px 10px;border-radius:5px}.fail{background:#f5e3dc;color:#912c20}.pass{background:#dfeddf;color:#176449}.small{font-size:12px;color:#62716a}a{color:#176449}.notice{background:#fffefa;padding:16px;border:1px solid #d4dcd5}@media(max-width:650px){header,main{padding:18px}.images{gap:8px}article{padding:16px}}</style><header><p class="small">SCENIC ROUTE / FEW-SHOT PREVIEW</p><h1>The examples the judge would learn from</h1><p>${examples.filter((e) => e.expectedVerdict === "fail").length} annotated failures and ${examples.filter((e) => e.expectedVerdict === "pass").length} accepted posters from the older review set. These examples teach background geography only.</p><p class="notice">All ${testManifest.cases.length} new posters are reserved for testing. Their ${testManifest.cases.length * 3} human ratings are saved and frozen at revision ${testHuman.revision}. None of these ${examples.length} teaching posters appear in that test set. The judge has not received this teaching set yet.</p><a href="teaching-set.json">Exact teaching-set manifest</a> · <a href="annotate.html">Your annotations</a> · <a href="http://127.0.0.1:8795/review.html">New-route human reviews</a></header><main><p>${esc(teaching.caution)}</p>${cards}</main></html>`,
);
console.log(
  JSON.stringify({
    examples: examples.length,
    fail: examples.filter((e) => e.expectedVerdict === "fail").length,
    pass: examples.filter((e) => e.expectedVerdict === "pass").length,
    testPosters: testManifest.cases.length,
    humanRevision: testHuman.revision,
    overlap: 0,
    preview: path.join(dir, "teaching.html"),
  }),
);

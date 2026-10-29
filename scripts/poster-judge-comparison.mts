import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { annotationDataset } from "./poster-annotations/core.mjs";
import { criteria, compareReview } from "./poster-review/core.mjs";
const { values } = parseArgs({
  options: { run: { type: "string" }, lab: { type: "string" } },
});
if (!values.run || !values.lab)
  throw new Error("Provide --run new-run-directory --lab original-lab");
const dir = path.resolve(values.run),
  lab = path.resolve(values.lab);
const [run, old, human] = await Promise.all(
  ["results.json", "baseline-dataset.json", "human-ratings.frozen.json"].map(
    async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")),
  ),
);
const next = {
  ...old,
  cases: old.cases.map((c: any) => ({
    ...c,
    judgment:
      run.results.find((r: any) => r.id === c.id)?.result?.judgment ?? null,
  })),
};
const before = compareReview(human.review, old),
  after = compareReview(human.review, next);
const rows = before.rows.map((r: any) => {
  const n = after.rows.find(
    (x: any) => x.id === r.id && x.criterion === r.criterion,
  )!;
  return {
    ...r,
    before: r.judge,
    after: n.judge,
    newOutcome: n.outcome,
    change:
      r.outcome === "agree" && n.outcome !== "agree"
        ? "regression"
        : r.outcome !== "agree" && n.outcome === "agree"
          ? "fixed"
          : n.outcome === "agree"
            ? "still_correct"
            : "still_disagrees",
  };
});
const data = {
  runAt: run.startedAt,
  model: run.model,
  promptVersion: run.promptVersion,
  frozenRevision: human.revision,
  total: run.results.length,
  errors: run.results.filter((r: any) => r.error).length,
  cost: run.results.reduce(
    (s: number, r: any) => s + (r.result?.costUsd ?? 0),
    0,
  ),
  before,
  after,
  rows,
  cases: old.cases.map((c: any) => ({
    ...c,
    newJudgment: next.cases.find((x: any) => x.id === c.id).judgment,
    notes: human.review.notes[c.id] ?? "",
  })),
  criteria,
};
await fs.cp(path.join(lab, "images"), path.join(dir, "images"), {
  recursive: true,
});
await fs.writeFile(
  path.join(dir, "comparison.json"),
  JSON.stringify(data, null, 2),
);
const annotationData = annotationDataset(data);
const [annotationTemplate, annotationCore, annotationClient] =
  await Promise.all(
    ["template.html", "core.mjs", "client.js"].map((f) =>
      fs.readFile(path.join("scripts/poster-annotations", f), "utf8"),
    ),
  );
await fs.writeFile(
  path.join(dir, "annotate.html"),
  annotationTemplate
    .replace("__DATA__", () =>
      JSON.stringify(annotationData).replaceAll("<", "\\u003c"),
    )
    .replace(
      "__CLIENT__",
      () =>
        annotationCore
          .slice(annotationCore.indexOf("export function emptyAnnotations"))
          .replace(/^export /gm, "") +
        "\n" +
        annotationClient,
    ),
);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rubric v4 · Judge comparison</title><style>
:root{font:15px/1.5 system-ui;color:#23312d;background:#f5f4ef}*{box-sizing:border-box}body{margin:0}header{padding:28px 32px;background:#fffefa;border-bottom:1px solid #d4dcd5}main{max-width:1450px;margin:auto;padding:28px 32px}h1{font-size:28px;margin:8px 0}h2{font-size:20px}h3{font-size:16px}.brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#62716a}p{max-width:1050px}.small{font-size:12px;color:#62716a}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:24px 0}.metric{border-top:3px solid #176449;padding:12px 0}.metric strong{display:block;font-size:28px}.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.panel,.case{background:#fffefa;border:1px solid #d4dcd5;border-radius:8px;padding:20px;margin:18px 0}.bar{height:12px;background:#e3e8e1;border-radius:4px;margin-top:8px}.bar span{display:block;height:100%;background:#176449;border-radius:4px}.filters{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0}select,button{font:inherit;padding:8px 12px;border:1px solid #cbd6cd;border-radius:5px;background:#fffefa;color:#23312d}button{cursor:pointer}label{font-size:12px}label select{display:block}.case-head{display:flex;justify-content:space-between;gap:14px;align-items:center}.fixed{color:#176449}.regression{color:#a2372c}.case-body{display:grid;grid-template-columns:190px 1fr;gap:20px}.thumb{width:100%;max-height:280px;object-fit:contain;background:white;cursor:zoom-in}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:20px}.evidence p{font-size:13px;white-space:pre-wrap}.note{padding:12px;background:#edf2e9;white-space:pre-wrap;font-size:13px}details p{font-size:13px;white-space:pre-wrap}summary{cursor:pointer}dialog{max-width:96vw;max-height:96vh;border:1px solid #ccd6cc}dialog img{max-width:90vw;max-height:85vh;display:block}a{color:#176449} @media(max-width:850px){.panels{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.case-body{grid-template-columns:1fr}.thumb{max-height:420px}.evidence{grid-template-columns:1fr}} </style>
<header><div class="brand">Scenic Route / Judge calibration experiment</div><h1>Did the revised rubric align the judge?</h1><p id="intro"></p><a href="http://127.0.0.1:8793/review.html#summary">Your human review summary</a> · <a href="annotate.html">Annotate geography failures</a></header><main><div id="metrics" class="metrics"></div><p id="coverage" class="small"></p><div id="criterion-panels" class="panels"></div><section class="panel"><h2>How to interpret this run</h2><p>Both prompts are compared against exactly the same frozen, adjudicated human ratings. No labels or review explanations were sent as evaluation answers. The revised prompt contains generalized rules from your feedback; no visual examples were added.</p><p>This is a calibration experiment on posters already used to draft the rubric. It is not held-out validation. A single run also mixes prompt effects with model variability; improvements need confirmation on unseen route families.</p><p id="run-info" class="small"></p><a href="prompt.txt">Exact prompt sent</a> · <a href="comparison.json">Download comparison data</a></section><div class="filters"><label>Criterion<select id="criterion"><option value="all">All criteria</option></select></label><label>Result<select id="change"><option value="changed">Fixes and regressions</option><option value="fixed">Fixed disagreements</option><option value="regression">New disagreements</option><option value="still_disagrees">Remaining disagreements</option><option value="all">All judgments</option></select></label></div><h2 id="count"></h2><div id="cases"></div></main><dialog id="zoom"><button id="close">Close</button><img id="large" alt="Enlarged poster or reference"></dialog><script id="data" type="application/json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script>
const d=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id),t=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e},pct=m=>m.agreement===null?'—':(m.agreement*100).toFixed(1)+'%';
const fixed=d.rows.filter(r=>r.change==='fixed').length,regressed=d.rows.filter(r=>r.change==='regression').length;
$('intro').textContent=d.total+' posters · '+d.rows.length+' criterion judgments · same '+d.model+' model · revised rubric only.';
for(const [label,value,detail] of [['Original rubric',pct(d.before.total),d.before.total.agree+'/'+d.before.total.compared+' binary verdicts agree'],['Updated rubric',pct(d.after.total),d.after.total.agree+'/'+d.after.total.compared+' binary verdicts agree'],['Disagreements fixed',fixed,'Previously wrong → now matches you'],['New disagreements',regressed,'Previously matched you → now differs']]){const e=t('div','','metric');e.append(t('span',label),t('strong',value),t('span',detail,'small'));$('metrics').append(e)}
$('coverage').textContent='Coverage: '+d.before.total.compared+'/'+d.rows.length+' original vs '+d.after.total.compared+'/'+d.rows.length+' updated binary verdicts. Updated: '+d.after.total.falseAccept+' false accepts, '+d.after.total.falseReject+' false rejects, '+d.after.total.abstained+' uncertain / non-binary verdicts. '+d.errors+' request errors.';
$('run-info').textContent='Frozen human revision '+d.frozenRevision+' · '+d.runAt+' · reported API cost $'+d.cost.toFixed(5)+'.';
for(const c of d.criteria){const b=d.before.byCriterion[c.key],a=d.after.byCriterion[c.key],e=t('section','','panel');e.append(t('h3',c.name),t('p',b.agree+'/'+b.compared+' → '+a.agree+'/'+a.compared+' agree'),t('p',a.falseAccept+' false accepts · '+a.falseReject+' false rejects · '+a.abstained+' non-binary','small'),t('p',(()=>{const failures=d.rows.filter(r=>r.criterion===c.key&&r.human==='fail');return failures.filter(r=>r.after==='fail').length+'/'+failures.length+' human failures caught';})(),'small'));const bar=t('div','','bar'),fill=t('span','');fill.style.width=(a.agreement??0)*100+'%';bar.append(fill);e.append(bar);$('criterion-panels').append(e);const o=t('option',c.name);o.value=c.key;$('criterion').append(o)}
function zoom(src){$('large').src=src;$('zoom').showModal()}$('close').onclick=()=>$('zoom').close();
function render(){const rows=d.rows.filter(r=>($('criterion').value==='all'||r.criterion===$('criterion').value)&&($('change').value==='all'||($('change').value==='changed'?['fixed','regression'].includes(r.change):r.change===$('change').value)));$('count').textContent=rows.length+' judgments shown';$('cases').replaceChildren();for(const r of rows){const item=d.cases.find(c=>c.id===r.id),c=d.criteria.find(c=>c.key===r.criterion),box=t('article','','case'),head=t('div','','case-head');head.append(t('h3',item.label+' · '+c.name),t('strong',({fixed:'Fixed',regression:'New disagreement',still_correct:'Still agrees',still_disagrees:'Still differs'})[r.change],r.change));box.append(head,t('p','Human target: '+r.human+' · Original judge: '+r.before+' · Updated judge: '+r.after));const body=t('div','','case-body'),pictures=t('div',''),img=t('img','');img.src=item.candidate;img.alt=item.label;img.className='thumb';img.onclick=()=>zoom(img.src);pictures.append(img);for(const ref of item.references){const b=t('button',ref.role);b.onclick=()=>zoom(ref.image);pictures.append(b)}const evidence=t('div','','evidence');for(const [label,a] of [['Original reasoning',item.judgment?.[r.criterion]],['Updated reasoning',item.newJudgment?.[r.criterion]]]){const col=t('div','');col.append(t('h3',label),t('p',a?.summary??'Request error'));const details=t('details','');details.append(t('summary','Visual evidence'));for(const issue of a?.issues??[])details.append(t('p',issue.location+'\\nReference: '+issue.referenceObservation+'\\nPoster: '+issue.candidateObservation));col.append(details);evidence.append(col)}body.append(pictures,evidence);box.append(body);if(item.notes)box.append(t('p','Your review notes: '+item.notes,'note'));$('cases').append(box)}}
$('criterion').onchange=render;$('change').onchange=render;render();</script></html>`;
const rendered =
  run.evaluationMode === "few-shot-calibration"
    ? html
        .replace(
          "<title>Rubric v4 · Judge comparison</title>",
          "<title>Few-shot judge · Comparison</title>",
        )
        .replace(
          "Did the revised rubric align the judge?",
          "Did visual teaching examples align the judge?",
        )
        .replace(
          "' model · revised rubric only.'",
          "' model · five visual teaching examples; teaching posters excluded.'",
        )
        .replace("['Original rubric',", "['Rubric only',")
        .replace("['Updated rubric',", "['With visual examples',")
        .replace(
          "Both prompts are compared against exactly the same frozen, adjudicated human ratings. No labels or review explanations were sent as evaluation answers. The revised prompt contains generalized rules from your feedback; no visual examples were added.",
          "Both variants are compared against the same frozen human ratings on the same 48 evaluation posters. Five other posters, with their annotated schematic comparisons and human explanations, are supplied as teaching examples in every few-shot request. Those five posters are excluded from scores. No evaluation-target human labels or notes are sent to the judge.",
        )
        .replace(
          "This is a calibration experiment on posters already used to draft the rubric. It is not held-out validation. A single run also mixes prompt effects with model variability; improvements need confirmation on unseen route families.",
          "This is a calibration experiment. Evaluation posters share route families with teaching examples, so this does not establish generalization to new routes. Only one human-failed geography case remains after excluding the five teaching failures; it concerns insufficient background detail and was deliberately omitted from teaching. Measure false rejections and failures caught alongside agreement. A single run mixes prompt effects with model variability.",
        )
        .replace(
          '<a href="prompt.txt">Exact prompt sent</a>',
          '<a href="prompt.txt">System prompt</a> · <a href="teaching-pack/preview.html">Teaching messages and images</a>',
        )
        .replace("Original reasoning", "Rubric-only reasoning")
        .replace("Updated reasoning", "Few-shot reasoning")
    : html;
await fs.writeFile(path.join(dir, "report.html"), rendered);
console.log(
  JSON.stringify({
    before: before.total,
    after: after.total,
    fixed: rows.filter((r: any) => r.change === "fixed").length,
    regressed: rows.filter((r: any) => r.change === "regression").length,
    report: path.join(dir, "report.html"),
  }),
);

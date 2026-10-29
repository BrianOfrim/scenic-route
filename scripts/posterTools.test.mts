import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fewShotJudgeMessages } from "./poster-fewshot.mts";
import { judgeMessages, type TrialCase } from "./posterJudge.mts";
const exec = promisify(execFile),
  scripts = path.dirname(fileURLToPath(import.meta.url));
const target: TrialCase = {
  id: "held-out",
  label: "hidden-label",
  kind: "poster",
  candidate: "hidden-file",
  references: [{ file: "hidden-reference", role: "schematic" }],
};
test("few-shot builder preserves target inputs and withholds target labels while teaching only geography", () => {
  const teaching = {
    instructions: "Teach geography only",
    examples: [
      {
        id: "training",
        images: [{ role: "candidate" }, { role: "schematic" }],
        expectedVerdict: "fail",
        explanation: "Opposite bank is missing.",
      },
    ],
  };
  const images = ["target-image", "target-reference"],
    messages = fewShotJudgeMessages(target, images, "shared rubric", teaching, [
      ["training-image", "training-reference"],
    ]);
  assert.equal(messages.length, 4);
  assert.ok(messages[0].content.startsWith("shared rubric"));
  assert.deepEqual(
    messages.at(-1),
    judgeMessages(target, images, "shared rubric")[1],
  );
  assert.equal(
    JSON.parse(messages[2].content).criterion,
    "background_geography",
  );
  assert.ok(!JSON.stringify(messages).includes("hidden-"));
  assert.throws(
    () =>
      fewShotJudgeMessages(
        { ...target, id: "training" },
        images,
        "rubric",
        teaching,
        [["a", "b"]],
      ),
    /must not include/,
  );
  assert.throws(
    () => fewShotJudgeMessages(target, images, "rubric", teaching, [["a"]]),
    /count mismatch/,
  );
});
test("human-only lab builds directly from a manifest without fabricated judge verdicts", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "human-only-lab-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await sharp({
    create: { width: 8, height: 12, channels: 3, background: "white" },
  })
    .png()
    .toFile(path.join(dir, "image.png"));
  const manifest = path.join(dir, "manifest.json"),
    out = path.join(dir, "lab");
  await fs.writeFile(
    manifest,
    JSON.stringify({
      cases: [
        {
          ...target,
          kind: "poster",
          candidate: "image.png",
          references: [{ role: "schematic", file: "image.png" }],
        },
      ],
    }),
  );
  const args = [
    "--import",
    "tsx",
    path.join(scripts, "poster-review.mts"),
    "--manifest",
    manifest,
    "--images",
    dir,
    "--out",
    out,
    "--build-only",
  ];
  await exec(process.execPath, args, { timeout: 30000 });
  const html = await fs.readFile(path.join(out, "review.html"), "utf8");
  const dataset = JSON.parse(
    html.match(/id="dataset">([\s\S]*?)<\/script>/)![1],
  );
  assert.equal(dataset.humanOnly, true);
  assert.equal(dataset.model, "Not evaluated");
  assert.equal(dataset.cases[0].judgment, null);
  await exec(process.execPath, args, { timeout: 30000 });
  const second = await fs.readFile(path.join(out, "review.html"), "utf8");
  assert.equal(
    JSON.parse(second.match(/id="dataset">([\s\S]*?)<\/script>/)![1]).id,
    dataset.id,
  );
});
test("teaching preparation uses explicit selections and excludes test posters", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-selection-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const run = path.join(dir, "run"),
    heldOut = path.join(dir, "test");
  await fs.mkdir(path.join(run, "images"), { recursive: true });
  await fs.mkdir(path.join(heldOut, "lab"), { recursive: true });
  await sharp({
    create: { width: 8, height: 12, channels: 3, background: "white" },
  })
    .png()
    .toFile(path.join(run, "images/image.png"));
  const examples = ["training-fail", "training-pass"].map((id) => ({
    id,
    label: id,
    candidate: "images/image.png",
    references: [{ role: "schematic", image: "images/image.png" }],
  }));
  await fs.writeFile(
    path.join(run, "comparison.json"),
    JSON.stringify({
      cases: examples,
      rows: [
        {
          id: "training-fail",
          criterion: "background_geography",
          human: "fail",
        },
        {
          id: "training-pass",
          criterion: "background_geography",
          human: "pass",
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(run, "geography-annotations.json"),
    JSON.stringify({
      revision: 1,
      annotations: {
        cases: {
          "training-fail": {
            ready: true,
            issues: [
              {
                label: "A",
                scope: "full_poster",
                explanation: "Insufficient context.",
                paths: {},
              },
            ],
          },
        },
      },
    }),
  );
  await fs.writeFile(
    path.join(heldOut, "manifest.json"),
    JSON.stringify({ cases: [{ id: "held-out" }] }),
  );
  await fs.writeFile(
    path.join(heldOut, "lab/human-ratings.json"),
    JSON.stringify({
      revision: 1,
      review: {
        ratings: {
          "held-out": {
            route_quality: "pass",
            background_geography: "pass",
            design: "pass",
          },
        },
      },
    }),
  );
  const selection = path.join(dir, "selection.json");
  await fs.writeFile(
    selection,
    JSON.stringify({
      examples: [
        { id: "training-fail", expectedVerdict: "fail" },
        { id: "training-pass", expectedVerdict: "pass" },
      ],
    }),
  );
  const args = [
    "--import",
    "tsx",
    path.join(scripts, "prepare-poster-teaching-set.mts"),
    "--run",
    run,
    "--test",
    heldOut,
    "--selection",
    selection,
  ];
  await exec(process.execPath, args, { timeout: 30000 });
  const output = JSON.parse(
    await fs.readFile(path.join(run, "teaching-set.json"), "utf8"),
  );
  assert.equal(output.examples.length, 2);
  assert.equal(output.testSet.teachingTestOverlap, 0);
  assert.equal(output.examples[0].annotations[0].scope, "full_poster");
  await fs.writeFile(
    path.join(heldOut, "manifest.json"),
    JSON.stringify({ cases: [{ id: "training-fail" }] }),
  );
  await fs.writeFile(
    path.join(heldOut, "lab/human-ratings.json"),
    JSON.stringify({
      revision: 1,
      review: {
        ratings: {
          "training-fail": {
            route_quality: "pass",
            background_geography: "fail",
            design: "pass",
          },
        },
      },
    }),
  );
  await assert.rejects(
    exec(process.execPath, args, { timeout: 30000 }),
    /Teaching and test posters must be disjoint/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  annotationDataset,
  emptyAnnotations,
  validateAnnotations,
} from "./core.mjs";
import { annotationService } from "./server.mjs";
const data = {
  runAt: "2026-10-27",
  model: "test",
  rows: [
    {
      id: "one",
      criterion: "background_geography",
      human: "fail",
      after: "pass",
    },
    { id: "two", criterion: "design", human: "fail", after: "pass" },
    {
      id: "three",
      criterion: "background_geography",
      human: "pass",
      after: "fail",
    },
  ],
  cases: [
    {
      id: "one",
      label: "One",
      notes: "Missing island",
      candidate: "images/a.png",
      references: [
        { role: "schematic", image: "images/b.png" },
        { role: "satellite", image: "images/c.png" },
      ],
      newJudgment: {
        background_geography: { verdict: "pass", summary: "Looks right" },
      },
    },
  ],
};
const dataset = annotationDataset(data);
const line = () => [
  { x: 0.1, y: 0.2 },
  { x: 0.2, y: 0.3 },
  { x: 0.5, y: 0.2 },
];
const example = () => ({
  ...emptyAnnotations(dataset),
  cases: {
    one: {
      ready: true,
      updatedAt: "2026-10-27T00:00:00Z",
      issues: [
        {
          label: "A",
          explanation: "Island missing",
          paths: { candidate: line(), "reference:0": line() },
        },
      ],
    },
  },
});
test("only geography false accepts become annotation cases, with stable image identities", () => {
  assert.equal(dataset.cases.length, 1);
  assert.equal(dataset.cases[0].notes, "Missing island");
  assert.equal(dataset.id, annotationDataset(data).id);
  assert.equal(dataset.cases[0].images[1].key, "reference:0");
});
test("polylines preserve vertices and reject invalid points or unknown images", () => {
  assert.deepEqual(validateAnnotations(example(), dataset), example());
  for (const points of [
    [],
    [{ x: 0.1, y: 0.1 }],
    [
      { x: -0.1, y: 0 },
      { x: 0.2, y: 0.2 },
    ],
    [
      { x: 0.1, y: 1.1 },
      { x: 0.2, y: 0.2 },
    ],
    [
      { x: NaN, y: 0 },
      { x: 0.2, y: 0.2 },
    ],
    Array(501).fill({ x: 0.1, y: 0.1 }),
  ]) {
    const b = example();
    b.cases.one.issues[0].paths.candidate = points;
    assert.throws(() => validateAnnotations(b, dataset), /Polylines/);
  }
  const b = example();
  b.cases.one.issues[0].paths.secret = line();
  assert.throws(
    () => validateAnnotations(b, dataset),
    /Unknown annotation image/,
  );
});
test("saved rectangles migrate losslessly to closed five-point polylines", () => {
  const old = {
    version: 1,
    datasetId: dataset.id,
    cases: {
      one: {
        ready: true,
        updatedAt: "2026-10-27T00:00:00Z",
        issues: [
          {
            label: "A",
            explanation: "Keep this note",
            boxes: {
              candidate: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
              "reference:0": { x: 0.2, y: 0.1, w: 0.5, h: 0.6 },
            },
          },
        ],
      },
    },
  };
  const migrated = validateAnnotations(old, dataset);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.cases.one.ready, true);
  assert.equal(migrated.cases.one.issues[0].explanation, "Keep this note");
  const points = migrated.cases.one.issues[0].paths.candidate;
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], points[4]);
  assert.equal(points[1].x, 0.4);
  assert.equal(old.version, 1);
  assert.ok(old.cases.one.issues[0].boxes);
});
test("ready examples require paired lines and explanation; incomplete work remains draft", () => {
  for (const field of ["candidate", "reference:0"]) {
    const a = example();
    delete a.cases.one.issues[0].paths[field];
    assert.throws(() => validateAnnotations(a, dataset), /mark ready/);
    a.cases.one.ready = false;
    assert.doesNotThrow(() => validateAnnotations(a, dataset));
  }
  const a = example();
  a.cases.one.issues[0].explanation = "";
  assert.throws(() => validateAnnotations(a, dataset), /mark ready/);
  a.cases.one.issues.push(structuredClone(a.cases.one.issues[0]));
  assert.throws(
    () => validateAnnotations(a, dataset),
    /Invalid annotation region/,
  );
});
test("polyline autosave persists revisions and rejects stale or cross-origin writes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "poster-annotations-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const handler = await annotationService(dir, dataset),
    server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (annotations, revision, from = origin) =>
    fetch(origin + "/annotations", {
      method: "POST",
      headers: { Origin: from, "Content-Type": "application/json" },
      body: JSON.stringify({ annotations, revision }),
    });
  assert.equal(
    (await post(example(), 0, "https://elsewhere.example")).status,
    403,
  );
  assert.equal((await post(example(), 0)).status, 200);
  assert.equal((await post(example(), 0)).status, 409);
  assert.equal(
    (await (await fetch(origin + "/annotations")).json()).revision,
    1,
  );
  const saved = JSON.parse(
    await fs.readFile(path.join(dir, "geography-annotations.json"), "utf8"),
  );
  assert.deepEqual(saved.annotations, example());
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(dir, "annotation-history/00000000.json"),
        "utf8",
      ),
    ).revision,
    0,
  );
  const restored = await annotationService(dir, dataset),
    second = http.createServer(restored);
  await new Promise((r) => second.listen(0, "127.0.0.1", r));
  try {
    assert.deepEqual(
      await (
        await fetch(`http://127.0.0.1:${second.address().port}/annotations`)
      ).json(),
      saved,
    );
  } finally {
    await new Promise((r) => second.close(r));
  }
});

test("full-poster comments can be ready without geometry, retaining the scope on export/save", () => {
  const a = example();
  a.cases.one.issues = [
    {
      label: "A",
      scope: "full_poster",
      explanation: "The background geography is insufficient overall.",
      paths: {},
    },
  ];
  assert.deepEqual(validateAnnotations(a, dataset), a);
  const noText = structuredClone(a);
  noText.cases.one.issues[0].explanation = "";
  assert.throws(() => validateAnnotations(noText, dataset), /explanation/);
  const regional = structuredClone(a);
  delete regional.cases.one.issues[0].scope;
  assert.throws(() => validateAnnotations(regional, dataset), /polyline/);
  const invalid = structuredClone(a);
  invalid.cases.one.issues[0].scope = "unknown";
  assert.throws(() => validateAnnotations(invalid, dataset), /scope/);
});

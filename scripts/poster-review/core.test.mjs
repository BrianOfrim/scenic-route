import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  criteria,
  emptyReview,
  validateReview,
  compareReview,
  extendReview,
  ratingCount,
  completedCaseIds,
  revealAssessed,
  comparisonDataset,
  confirmCaseAssessment,
  carryReviewToRejudgedDataset,
  disagreementCases,
  saveDisagreement,
  calibrationBundle,
  correctDisagreementRating,
  disagreementSummary,
} from "./core.mjs";
import { createReviewServer } from "./server.mjs";
import {
  combineRouteVerdicts,
  combineRouteAssessments,
  migrateFourCriterionReview,
} from "./rubricMigration.mjs";

const dataset = {
  id: "test-trial",
  cases: [
    {
      id: "one",
      label: "One",
      judgment: {
        route_quality: { verdict: "pass" },
        background_geography: { verdict: "uncertain" },
        design: { verdict: "fail" },
      },
    },
  ],
};
const completed = () => ({
  ...emptyReview(dataset.id),
  ratings: {
    one: {
      route_quality: "fail",
      background_geography: "pass",
      design: "pass",
    },
  },
});

test("fresh judge results preserve human assessments only when rubric, images and briefs match", () => {
  const source = {
    ...dataset,
    judgeVersion: "poster-judge-v3",
    cases: [
      {
        ...dataset.cases[0],
        candidate: "images/candidate.png",
        references: [{ role: "schematic", image: "images/reference.png" }],
        brief: { style: "Modernist" },
      },
    ],
  };
  const destination = { ...structuredClone(source), id: "new-judge-run" };
  destination.cases[0].judgment.route_quality.verdict = "fail";
  const human = {
    ...completed(),
    notes: { one: "Keep my note" },
    previouslyRevealedCaseIds: ["one"],
  };
  const copied = carryReviewToRejudgedDataset(human, source, destination);
  assert.equal(copied.datasetId, destination.id);
  assert.deepEqual(copied.ratings, human.ratings);
  assert.deepEqual(copied.notes, human.notes);
  assert.deepEqual(
    copied.previouslyRevealedCaseIds,
    human.previouslyRevealedCaseIds,
  );
  assert.equal(human.datasetId, source.id);
  assert.notEqual(
    compareReview(human, source).total.agree,
    compareReview(copied, destination).total.agree,
  );
  const changed = structuredClone(destination);
  changed.cases[0].candidate = "images/other.png";
  assert.throws(
    () => carryReviewToRejudgedDataset(human, source, changed),
    /original images and brief/,
  );
  assert.throws(
    () =>
      carryReviewToRejudgedDataset(human, source, {
        ...destination,
        judgeVersion: "poster-judge-v2",
      }),
    /same rubric/,
  );
});

test("default-pass confirmation affects only the reviewed poster and preserves explicit failures", () => {
  const trial = {
    ...dataset,
    cases: [...dataset.cases, { ...dataset.cases[0], id: "two" }],
  };
  const empty = emptyReview(trial.id);
  assert.equal(ratingCount(empty), 0);
  const saved = confirmCaseAssessment(empty, trial, "one");
  assert.deepEqual(saved.ratings.one, {
    route_quality: "pass",
    background_geography: "pass",
    design: "pass",
  });
  assert.equal(saved.ratings.two, undefined);
  assert.equal(ratingCount(saved), 3);
  assert.equal(ratingCount(empty), 0);
  const overridden = confirmCaseAssessment(saved, trial, "one", {
    background_geography: "fail",
  });
  assert.equal(
    confirmCaseAssessment(overridden, trial, "one").ratings.one
      .background_geography,
    "fail",
  );
  const revealed = revealAssessed(overridden, trial);
  const edited = confirmCaseAssessment(revealed, trial, "one", {
    background_geography: "pass",
  });
  assert.equal(edited.ratings.one.background_geography, "pass");
  assert.deepEqual(edited.previouslyRevealedCaseIds, ["one"]);
  assert.equal(
    confirmCaseAssessment(revealed, trial, "two").ratings.two.design,
    "pass",
  );
  assert.throws(
    () => confirmCaseAssessment(empty, trial, "unknown"),
    /Unknown poster/,
  );
  assert.throws(
    () => confirmCaseAssessment(empty, trial, "one", { design: "uncertain" }),
    /Invalid rating/,
  );
});

test("combining route checks fails on either failure and preserves uncertainty", () => {
  for (const shape of ["pass", "fail", "uncertain"])
    for (const placement of ["pass", "fail", "uncertain", "not_applicable"]) {
      const expected =
        shape === "fail" || placement === "fail"
          ? "fail"
          : shape === "uncertain" || placement === "uncertain"
            ? "uncertain"
            : "pass";
      assert.equal(combineRouteVerdicts(shape, placement), expected);
    }
  assert.throws(
    () => combineRouteVerdicts("pass", undefined),
    /Invalid source/,
  );
  assert.throws(
    () => combineRouteVerdicts("not_applicable", "pass"),
    /Invalid source/,
  );
  const combined = combineRouteAssessments(
    { verdict: "pass", summary: "Shape matches", issues: [] },
    {
      verdict: "fail",
      summary: "Wrong shoreline",
      issues: [
        {
          location: "east",
          referenceObservation: "shoreline",
          candidateObservation: "inland",
        },
      ],
    },
  );
  assert.equal(combined.verdict, "fail");
  assert.equal(combined.issues[0].location, "Geographic placement — east");
});

test("four-to-three migration preserves other ratings, notes and exposure without inventing partial route ratings", () => {
  const oldDataset = {
    id: "old",
    judgeVersion: "poster-judge-v2",
    cases: [{ id: "one" }, { id: "two" }],
  };
  const destination = {
    id: "new",
    judgeVersion: "poster-judge-v3",
    cases: [{ id: "one" }, { id: "two" }],
  };
  const previous = {
    version: 2,
    datasetId: "old",
    ratings: {
      one: {
        route: "pass",
        route_geography: "fail",
        background_geography: "pass",
        design: "fail",
      },
      two: { route: "pass", design: "pass" },
    },
    notes: { one: "Original note" },
    revealedAt: null,
    previouslyRevealedCaseIds: ["one"],
  };
  const migrated = migrateFourCriterionReview(
    previous,
    oldDataset,
    destination,
  );
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.ratings.one, {
    route_quality: "fail",
    background_geography: "pass",
    design: "fail",
  });
  assert.deepEqual(migrated.ratings.two, { design: "pass" });
  assert.equal(migrated.notes.one, "Original note");
  assert.deepEqual(migrated.previouslyRevealedCaseIds, ["one"]);
  assert.equal(migrated.revealedAt, null);
  assert.equal(previous.ratings.one.route_geography, "fail");
  assert.throws(
    () =>
      migrateFourCriterionReview(
        { ...previous, datasetId: "wrong" },
        oldDataset,
        destination,
      ),
    /Expected a v2 review/,
  );
  assert.throws(
    () => validateReview(previous, destination),
    /different trial or rubric/,
  );
  const finished = structuredClone(previous);
  finished.ratings.two = {
    route: "pass",
    route_geography: "pass",
    background_geography: "fail",
    design: "pass",
  };
  finished.revealedAt = "2026-10-27T20:00:00.000Z";
  assert.equal(
    migrateFourCriterionReview(finished, oldDataset, destination).revealedAt,
    finished.revealedAt,
  );
});

test("comparison separates disagreement direction, abstentions and missing human labels", () => {
  const result = compareReview(completed(), dataset);
  assert.deepEqual(result.total, {
    rated: 3,
    compared: 2,
    agree: 0,
    falseAccept: 1,
    falseReject: 1,
    abstained: 1,
    agreement: 0,
  });
  assert.equal(result.byCriterion.background_geography.compared, 0);
  assert.equal(result.byCriterion.background_geography.agreement, null);
  const empty = compareReview(emptyReview(dataset.id), dataset);
  assert.equal(empty.total.compared, 0);
  assert.equal(empty.total.rated, 0);
  assert.equal(empty.total.agreement, null);
  const missing = compareReview(completed(), {
    ...dataset,
    cases: [{ id: "one", label: "One", judgment: null }],
  });
  assert.equal(missing.total.abstained, 3);
  assert.equal(missing.total.compared, 0);
});

test("validate imported ratings, rejecting mismatched datasets and premature reveals", () => {
  assert.deepEqual(validateReview(completed(), dataset), completed());
  assert.throws(
    () => validateReview({ ...completed(), datasetId: "other" }, dataset),
    /different trial/,
  );
  assert.throws(
    () =>
      validateReview(
        { ...completed(), ratings: { one: { route_quality: "uncertain" } } },
        dataset,
      ),
    /pass or fail/,
  );
  assert.throws(
    () =>
      validateReview(
        { ...emptyReview(dataset.id), revealedAt: new Date().toISOString() },
        dataset,
      ),
    /Complete all/,
  );
  assert.throws(
    () =>
      validateReview(
        { ...completed(), notes: { one: "x".repeat(4001) } },
        dataset,
      ),
    /Invalid note/,
  );
  assert.throws(
    () => validateReview({ ...completed(), version: 1 }, dataset),
    /different trial or rubric/,
  );
  assert.throws(
    () =>
      validateReview(
        {
          ...completed(),
          ratings: { one: { geography: "pass", text: "pass" } },
        },
        dataset,
      ),
    /three criteria/,
  );
  const done = { ...completed(), revealedAt: new Date().toISOString() };
  assert.deepEqual(validateReview(done, dataset), done);
});

test("combined route quality and background geography are scored independently", () => {
  assert.deepEqual(
    criteria.map((c) => c.key),
    ["route_quality", "background_geography", "design"],
  );
  const dataset = {
    id: "separate-geography",
    cases: [
      {
        id: "one",
        label: "One",
        judgment: {
          route_quality: { verdict: "fail" },
          background_geography: { verdict: "pass" },
          design: { verdict: "pass" },
        },
      },
    ],
  };
  const review = {
    ...emptyReview(dataset.id),
    ratings: {
      one: {
        route_quality: "fail",
        background_geography: "fail",
        design: "pass",
      },
    },
  };
  const compared = compareReview(review, dataset);
  assert.equal(compared.byCriterion.route_quality.agree, 1);
  assert.equal(compared.byCriterion.background_geography.falseAccept, 1);
});

test("expanding a lab preserves partial ratings, notes and previously revealed locks", () => {
  const next = {
    ...dataset,
    id: "expanded",
    cases: [...dataset.cases, { ...dataset.cases[0], id: "two" }],
  };
  const partial = {
    ...emptyReview(dataset.id),
    ratings: { one: { route_quality: "fail" } },
    notes: { one: "Keep this note" },
  };
  const copied = extendReview(partial, dataset, next);
  assert.equal(copied.datasetId, next.id);
  assert.equal(ratingCount(copied), 1);
  assert.equal(copied.notes.one, "Keep this note");
  assert.deepEqual(copied.previouslyRevealedCaseIds, []);
  const previous = { ...completed(), revealedAt: new Date().toISOString() };
  const expanded = extendReview(previous, dataset, next);
  assert.deepEqual(expanded.ratings.one, previous.ratings.one);
  assert.deepEqual(expanded.previouslyRevealedCaseIds, ["one"]);
  assert.equal(expanded.revealedAt, null);
  assert.equal(expanded.ratings.two, undefined);
  assert.equal(previous.revealedAt === null, false);
  assert.throws(
    () => extendReview(previous, dataset, { ...next, cases: [] }),
    /retain every/,
  );
  assert.throws(
    () =>
      validateReview({ ...expanded, previouslyRevealedCaseIds: ["two"] }, next),
    /previously revealed/,
  );
});

test("intermediate comparison reveals only fully assessed posters and excludes partial ratings", () => {
  const trial = {
    ...dataset,
    id: "intermediate",
    cases: [
      dataset.cases[0],
      { ...dataset.cases[0], id: "two" },
      { ...dataset.cases[0], id: "three" },
    ],
  };
  const review = {
    ...emptyReview(trial.id),
    ratings: { one: completed().ratings.one, two: { route_quality: "pass" } },
  };
  assert.deepEqual(completedCaseIds(review, trial), ["one"]);
  assert.equal(comparisonDataset(review, trial).cases.length, 0);
  const revealed = revealAssessed(review, trial);
  assert.equal(revealed.revealedAt, null);
  assert.deepEqual(revealed.previouslyRevealedCaseIds, ["one"]);
  assert.deepEqual(review.previouslyRevealedCaseIds, []);
  assert.deepEqual(
    comparisonDataset(revealed, trial).cases.map((c) => c.id),
    ["one"],
  );
  const comparison = compareReview(
    revealed,
    comparisonDataset(revealed, trial),
  );
  assert.equal(comparison.total.rated, 3);
  assert.equal(comparison.rows.length, 3);
  assert.equal(
    comparison.rows.some((r) => r.id === "two" || r.id === "three"),
    false,
  );
  assert.throws(
    () => revealAssessed(emptyReview(trial.id), trial),
    /at least one poster/,
  );
  revealed.ratings.two = { ...completed().ratings.one };
  const updated = revealAssessed(revealed, trial);
  assert.deepEqual(updated.previouslyRevealedCaseIds, ["one", "two"]);
  assert.equal(updated.revealedAt, null);
  updated.ratings.three = { ...completed().ratings.one };
  const final = revealAssessed(updated, trial, "2026-10-24T20:00:00.000Z");
  assert.equal(final.revealedAt, "2026-10-24T20:00:00.000Z");
  assert.equal(comparisonDataset(final, trial).cases.length, 3);
  assert.deepEqual(revealAssessed(final, trial), final);
});

test("local server persists post-reveal edits with history and rejects stale/cross-origin writes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "poster-review-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const htmlPath = path.join(dir, "review.html"),
    ratingsPath = path.join(dir, "human-ratings.json");
  await fs.writeFile(htmlPath, "<h1>Review</h1>");
  await fs.mkdir(path.join(dir, "images"));
  const imageName = "a".repeat(64) + ".png";
  await fs.writeFile(path.join(dir, "images", imageName), "image bytes");
  const server = await createReviewServer({ dataset, htmlPath, ratingsPath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (review, revision, from = origin) =>
    fetch(origin + "/ratings", {
      method: "POST",
      headers: { Origin: from, "Content-Type": "application/json" },
      body: JSON.stringify({ review, revision }),
    });
  assert.equal((await fetch(origin + "/review.html")).status, 200);
  const imageResponse = await fetch(origin + "/images/" + imageName);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.equal(await imageResponse.text(), "image bytes");
  assert.equal((await fetch(origin + "/images/private.json")).status, 404);
  assert.equal(
    (await post(completed(), 0, "https://unrelated.example")).status,
    403,
  );
  assert.equal((await post(completed(), 0)).status, 200);
  assert.equal((await post(completed(), 0)).status, 409);
  let persisted = JSON.parse(await fs.readFile(ratingsPath, "utf8"));
  assert.equal(persisted.revision, 1);
  assert.deepEqual(persisted.review, completed());
  assert.deepEqual(await (await fetch(origin + "/ratings")).json(), persisted);
  const locked = { ...completed(), revealedAt: new Date().toISOString() };
  assert.equal((await post(locked, 1)).status, 200);
  const edited = structuredClone(locked);
  edited.ratings.one.route_quality = "pass";
  assert.equal((await post(edited, 2)).status, 200);
  persisted = JSON.parse(await fs.readFile(ratingsPath, "utf8"));
  assert.deepEqual(persisted.review, edited);
  assert.deepEqual(persisted.changes, [
    {
      id: "one",
      criterion: "route_quality",
      from: "fail",
      to: "pass",
      afterReveal: true,
    },
  ]);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(dir, "ratings-history", "00000002.json"),
        "utf8",
      ),
    ).review,
    locked,
  );
  const restored = await createReviewServer({ dataset, htmlPath, ratingsPath });
  await new Promise((resolve) => restored.listen(0, "127.0.0.1", resolve));
  try {
    assert.deepEqual(
      await (
        await fetch(`http://127.0.0.1:${restored.address().port}/ratings`)
      ).json(),
      persisted,
    );
  } finally {
    await new Promise((resolve) => restored.close(resolve));
  }
});

test("expanded lab allows edits to previously revealed labels and records their exposure", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "poster-review-expand-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const expandedDataset = {
    ...dataset,
    id: "expanded",
    cases: [...dataset.cases, { ...dataset.cases[0], id: "two" }],
  };
  const review = extendReview(
    { ...completed(), revealedAt: new Date().toISOString() },
    dataset,
    expandedDataset,
  );
  const ratingsPath = path.join(dir, "human-ratings.json");
  await fs.writeFile(ratingsPath, JSON.stringify({ revision: 0, review }));
  const server = await createReviewServer({
    dataset: expandedDataset,
    htmlPath: path.join(dir, "review.html"),
    ratingsPath,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (review, revision) =>
    fetch(origin + "/ratings", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ revision, review }),
    });
  const edited = structuredClone(review);
  edited.ratings.one.route_quality = "pass";
  assert.equal((await post(edited, 0)).status, 200);
  let saved = JSON.parse(await fs.readFile(ratingsPath, "utf8"));
  assert.equal(saved.changes[0].afterReveal, true);
  const next = structuredClone(edited);
  next.ratings.two = { route_quality: "pass" };
  assert.equal((await post(next, 1)).status, 200);
  assert.deepEqual(
    JSON.parse(await fs.readFile(ratingsPath, "utf8")).review.ratings,
    next.ratings,
  );
  const removedMarker = structuredClone(next);
  removedMarker.previouslyRevealedCaseIds = [];
  assert.equal((await post(removedMarker, 2)).status, 200);
  const laterEdit = structuredClone(removedMarker);
  laterEdit.ratings.one.route_quality = "fail";
  assert.equal((await post(laterEdit, 3)).status, 200);
  saved = JSON.parse(await fs.readFile(ratingsPath, "utf8"));
  assert.equal(saved.changes[0].afterReveal, true);
  assert.deepEqual(saved.everRevealedCaseIds, ["one"]);
});

test("adjudication preserves original conflicts and exports only completed feedback", () => {
  const revealed = revealAssessed(completed(), dataset);
  assert.equal(disagreementCases(completed(), dataset).length, 0);
  assert.equal(disagreementCases(revealed, dataset).length, 2);
  assert.throws(
    () =>
      saveDisagreement(revealed, dataset, "one:route_quality", {
        decision: "keep_human",
        reason: "style",
        rationale: "",
        rule: "",
      }),
    /Add decisive evidence/,
  );
  const input = {
    decision: "accept_judge",
    reason: "missed_detail",
    rationale: "The turn is visible on closer inspection.",
    rule: "Inspect all corners before failing.",
  };
  const saved = saveDisagreement(revealed, dataset, "one:route_quality", input);
  assert.equal(saved.ratings.one.route_quality, "pass");
  assert.equal(revealed.ratings.one.route_quality, "fail");
  const row = disagreementCases(saved, dataset).find(
    (r) => r.criterion === "route_quality",
  );
  assert.equal(row.status, "reviewed");
  assert.equal(row.originalHuman, "fail");
  assert.equal(disagreementCases(saved, dataset).length, 2);
  assert.equal(calibrationBundle(saved, dataset).examples.length, 1);
  assert.equal(calibrationBundle(saved, dataset).rules.length, 1);
  const pending = saveDisagreement(saved, dataset, "one:design", {
    ...input,
    decision: "unsure",
    rationale: "",
    rule: "Draft rule",
  });
  assert.equal(calibrationBundle(pending, dataset).rules.length, 1);
  const changed = structuredClone(saved);
  changed.ratings.one.route_quality = "fail";
  assert.equal(disagreementCases(changed, dataset)[0].status, "stale");
  assert.equal(calibrationBundle(changed, dataset).examples.length, 0);
  const rejudged = structuredClone(dataset);
  rejudged.cases[0].judgment.route_quality.verdict = "fail";
  assert.equal(disagreementCases(saved, rejudged)[0].status, "stale");
  assert.equal(
    validateReview({ ...revealed, feedback: undefined }, dataset).feedback
      .constructor,
    Object,
  );
});

test("direct rating correction requires no explanation and retains the original disagreement", () => {
  const original = revealAssessed(completed(), dataset);
  const corrected = correctDisagreementRating(
    original,
    dataset,
    "one:route_quality",
    "pass",
  );
  assert.equal(corrected.ratings.one.route_quality, "pass");
  assert.equal(original.ratings.one.route_quality, "fail");
  const row = disagreementCases(corrected, dataset).find(
    (r) => r.criterion === "route_quality",
  );
  assert.equal(row.status, "reviewed");
  assert.equal(row.originalHuman, "fail");
  assert.equal(row.feedback.decision, "accept_judge");
  const restored = correctDisagreementRating(
    corrected,
    dataset,
    row.key,
    "fail",
  );
  assert.equal(restored.ratings.one.route_quality, "fail");
  assert.equal(
    disagreementCases(restored, dataset)[0].feedback.decision,
    "keep_human",
  );
  assert.deepEqual(
    correctDisagreementRating(restored, dataset, row.key, "fail"),
    restored,
  );
  assert.throws(
    () => correctDisagreementRating(completed(), dataset, row.key, "pass"),
    /revealed disagreements/,
  );
});

test("review summary separates human corrections from retained model disagreements", () => {
  const hidden = disagreementSummary(completed(), dataset);
  assert.equal(hidden.total, 0);
  const revealed = revealAssessed(completed(), dataset);
  let s = disagreementSummary(revealed, dataset);
  assert.equal(s.total, 2);
  assert.equal(s.pending, 2);
  const corrected = correctDisagreementRating(
    revealed,
    dataset,
    "one:route_quality",
    "pass",
  );
  const reviewed = saveDisagreement(corrected, dataset, "one:design", {
    decision: "keep_human",
    reason: "style",
    rationale: "This design is acceptable.",
    rule: "Allow this style.",
  });
  s = disagreementSummary(reviewed, dataset);
  assert.equal(s.total, 2);
  assert.equal(s.kept, 1);
  assert.equal(s.corrected, 1);
  assert.equal(s.remaining, 1);
  assert.equal(s.pending, 0);
  assert.equal(s.rules, 1);
  assert.equal(s.byCriterion.route_quality.corrected, 1);
  assert.equal(s.byCriterion.design.kept, 1);
  assert.equal(s.reasons.style, 1);
  assert.equal(s.current.agree, 1);
  const stale = structuredClone(reviewed);
  stale.ratings.one.design = "fail";
  assert.equal(disagreementSummary(stale, dataset).pending, 1);
  assert.equal(disagreementSummary(stale, dataset).rules, 0);
});

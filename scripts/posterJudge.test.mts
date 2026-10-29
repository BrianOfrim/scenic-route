import assert from "node:assert/strict";
import test from "node:test";
import {
  JUDGE_SCHEMA,
  JUDGE_VERSION,
  judgeCase,
  judgeMessages,
  parseJudgment,
  type Judgment,
  type TrialCase,
} from "./posterJudge.mts";

const item: TrialCase = {
  id: "secret-id",
  label: "secret-label-missing-loop",
  kind: "shape-control",
  candidate: "secret-candidate.png",
  references: [{ file: "secret-reference.png", role: "route-only" }],
  expectedRouteVerdict: "fail",
};
const images = [
  "data:image/png;base64,candidate",
  "data:image/png;base64,reference",
];
function valid(): Judgment {
  return {
    route_quality: {
      verdict: "pass",
      summary: "No visible mismatch",
      issues: [],
    },
    background_geography: {
      verdict: "not_applicable",
      summary: "Shape control",
      issues: [],
    },
    design: { verdict: "not_applicable", summary: "Shape control", issues: [] },
  };
}

test("revised rubric requires independent route/background assessments and rejects legacy verdicts", () => {
  assert.equal(JUDGE_VERSION, "poster-judge-v3");
  assert.deepEqual(JUDGE_SCHEMA.required, [
    "route_quality",
    "background_geography",
    "design",
  ]);
  const legacy = {
    route: valid().route_quality,
    geography: valid().route_quality,
    text: valid().route_quality,
    design: valid().design,
  };
  assert.throws(() => parseJudgment(legacy, "poster"), /Invalid route_quality/);
  const independent = valid();
  independent.route_quality = {
    verdict: "fail",
    summary: "Loop omitted",
    issues: [
      {
        location: "north",
        referenceObservation: "loop",
        candidateObservation: "straight segment",
      },
    ],
  };
  independent.background_geography = {
    verdict: "pass",
    summary: "Background itself matches",
    issues: [],
  };
  assert.equal(
    parseJudgment(independent, "poster").background_geography.verdict,
    "pass",
  );
});

test("judge does not see expected answers, labels, IDs or source filenames", () => {
  const messages = judgeMessages(item, images);
  const payload = JSON.stringify(messages);
  assert.ok(!payload.includes("secret-"));
  assert.ok(!payload.includes("expectedRouteVerdict"));
  assert.equal(
    payload,
    JSON.stringify(
      judgeMessages({ ...item, expectedRouteVerdict: "pass" }, images),
    ),
  );
  const content = messages[1].content as any[];
  assert.equal(content[1].image_url.url, images[0]);
  assert.equal(content[2].image_url.url, images[1]);
  assert.throws(() => judgeMessages(item, [images[0]]), /count mismatch/);
});

test("invalid, unevidenced, and inapplicable route judgments cannot become passes", () => {
  assert.throws(() => parseJudgment({}, "poster"), /Invalid route/);
  const failure = valid();
  failure.route_quality.verdict = "fail";
  assert.throws(() => parseJudgment(failure, "poster"), /no evidence/);
  const skipped = valid();
  skipped.route_quality.verdict = "not_applicable";
  assert.throws(() => parseJudgment(skipped, "poster"), /must be assessed/);
  const unclear = valid();
  unclear.route_quality.verdict = "uncertain";
  assert.equal(
    parseJudgment(unclear, "poster").route_quality.verdict,
    "uncertain",
  );
  const invalidIssue = valid();
  invalidIssue.route_quality.issues = [
    { location: "top", referenceObservation: "", candidateObservation: "loop" },
  ];
  assert.throws(() => parseJudgment(invalidIssue, "poster"), /Invalid route/);
});

test("poster design cannot override route failure; shape controls exclude other dimensions", () => {
  const judged = valid();
  judged.route_quality.verdict = "fail";
  judged.route_quality.issues.push({
    location: "top",
    referenceObservation: "loop",
    candidateObservation: "straight line",
  });
  judged.design = { verdict: "pass", summary: "Good composition", issues: [] };
  assert.equal(parseJudgment(judged, "poster").route_quality.verdict, "fail");
  assert.throws(
    () => parseJudgment(judged, "shape-control"),
    /unrelated assessments/,
  );
});

test("request uses fixed model, strict schema and high-detail images; missing cost stays unknown", async () => {
  const result = await judgeCase(item, images, {
    model: "test/vision",
    key: "secret-key",
    fetcher: async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const request = JSON.parse(init!.body as string);
      assert.equal(request.model, "test/vision");
      assert.equal(request.response_format.json_schema.strict, true);
      assert.equal(request.messages[1].content[1].image_url.detail, "high");
      return Response.json({
        id: "request-1",
        model: "test/vision",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(valid()) },
          },
        ],
      });
    },
  });
  assert.equal(result.costUsd, null);
  assert.equal(result.requestId, "request-1");
  assert.equal(result.requestHash.length, 64);
  assert.ok(!JSON.stringify(result).includes("secret-key"));
});

test("truncation, provider errors, malformed JSON and refusals stay errors without retry", async () => {
  for (const response of [
    () =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: JSON.stringify(valid()) },
          },
        ],
      }),
    () =>
      Response.json(
        { error: { code: 402, message: "private error detail" } },
        { status: 402 },
      ),
    () =>
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: "not json" } }],
      }),
    () =>
      Response.json({
        choices: [{ finish_reason: "stop", message: { refusal: "no" } }],
      }),
  ]) {
    let calls = 0;
    await assert.rejects(
      judgeCase(item, images, {
        model: "test/vision",
        key: "key",
        fetcher: async () => {
          calls++;
          return response();
        },
      }),
    );
    assert.equal(calls, 1);
  }
});

test("explicit experimental rubric is sent without changing the default judge", async () => {
  const baseline = judgeMessages(item, images)[0].content;
  await judgeCase(item, images, {
    model: "test/vision",
    key: "key",
    prompt: "Experimental rubric only",
    fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.messages[0].content, "Experimental rubric only");
      assert.ok(!JSON.stringify(body).includes("secret-"));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(valid()) },
          },
        ],
      });
    },
  });
  assert.equal(judgeMessages(item, images)[0].content, baseline);
});

test("visual teaching messages precede the target without leaking target labels", async () => {
  const teachingMessages = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,teaching" },
        },
      ],
    },
    {
      role: "assistant",
      content: '{"background_geography":{"verdict":"fail"}}',
    },
  ];
  await judgeCase(item, images, {
    model: "test/vision",
    key: "key",
    teachingMessages,
    fetcher: async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      assert.equal(request.messages.length, 4);
      assert.deepEqual(request.messages.slice(1, 3), teachingMessages);
      assert.equal(request.messages[3].content[1].image_url.url, images[0]);
      assert.ok(!JSON.stringify(request).includes("secret-"));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(valid()) },
          },
        ],
      });
    },
  });
});

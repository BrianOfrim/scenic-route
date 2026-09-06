import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLlmTrace, formatLlmTraceConsole, sanitizeForTrace, type LlmTrace } from "./llmTrace";

test("sanitizeForTrace leaves planner messages intact", () => {
  const messages = [
    { role: "system", content: "You write structured prompts." },
    { role: "user", content: JSON.stringify({ title: "Lunch ride" }) },
  ];
  assert.deepEqual(sanitizeForTrace({ model: "anthropic/claude-sonnet-4", messages }), {
    model: "anthropic/claude-sonnet-4",
    messages,
  });
});

test("sanitizeForTrace redacts data URLs and image bytes", () => {
  const payload = {
    prompt: "map poster",
    input_references: [
      { type: "image_url", image_url: { url: "data:image/png;base64,aaaa" } },
    ],
    data: [{ b64_json: "x".repeat(120), media_type: "image/png" }],
  };
  const sanitized = sanitizeForTrace(payload) as {
    prompt: string;
    input_references: Array<{ image_url: { url: string } }>;
    data: Array<{ b64_json: string; media_type: string }>;
  };
  assert.equal(sanitized.prompt, "map poster");
  assert.match(sanitized.input_references[0].image_url.url, /^\[data-url image\/png \d+ bytes\]$/);
  assert.equal(sanitized.data[0].b64_json, "[base64 120 chars]");
  assert.equal(sanitized.data[0].media_type, "image/png");
  assert.equal(payload.data[0].b64_json.length, 120);
});

test("formatLlmTrace includes request, response, and cost", () => {
  const trace: LlmTrace = {
    id: "20260905T191200Z-abc",
    kind: "chat",
    label: "plan",
    model: "anthropic/claude-sonnet-4",
    url: "https://openrouter.ai/api/v1/chat/completions",
    startedAt: "2026-09-05T19:12:00.000Z",
    durationMs: 1234,
    ok: true,
    status: 200,
    cost: 0.0123,
    request: { messages: [{ role: "user", content: "hello" }] },
    response: { choices: [{ message: { content: '{"title":"Lunch ride"}' } }] },
    error: null,
    file: "/tmp/trace.json",
  };
  const text = formatLlmTrace(trace);
  assert.match(text, /\[llm:plan\] ok 20260905T191200Z-abc/);
  assert.match(text, /1234ms cost=\$0\.0123/);
  assert.match(text, /"content": "hello"/);
  assert.match(text, /Lunch ride/);
  assert.match(text, /wrote \/tmp\/trace\.json/);
});

test("formatLlmTraceConsole stays short", () => {
  const text = formatLlmTraceConsole({
    id: "20260905T191200Z-abc",
    kind: "chat",
    label: "plan",
    model: "anthropic/claude-sonnet-4",
    url: "https://openrouter.ai/api/v1/chat/completions",
    startedAt: "2026-09-05T19:12:00.000Z",
    durationMs: 1234,
    ok: false,
    status: null,
    cost: null,
    request: { messages: [{ role: "user", content: "hello" }] },
    response: null,
    error: "Planner timed out",
    file: "/tmp/trace.json",
  });
  assert.match(text, /error Planner timed out/);
  assert.doesNotMatch(text, /hello/);
});

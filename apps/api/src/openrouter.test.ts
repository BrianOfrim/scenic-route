import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMaxRefs, parseImageResponse } from "./openrouter";

test("parseImageResponse reads b64 and cost", () => {
  const parsed = parseImageResponse({
    data: [{ b64_json: "aaaa", media_type: "image/png" }],
    usage: { cost: 0.04 },
  });
  assert.equal(parsed.b64, "aaaa");
  assert.equal(parsed.cost, 0.04);
});

test("extractMaxRefs reads endpoint metadata", () => {
  assert.equal(
    extractMaxRefs({
      data: { endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] },
    }),
    3,
  );
  assert.equal(extractMaxRefs({ data: { max_input_references: 4 } }), 4);
  assert.equal(extractMaxRefs({}), null);
});

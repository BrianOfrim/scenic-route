import assert from "node:assert/strict";
import { test } from "node:test";
import { VARIANTS_PER_PROMPT, variantCount } from "./poster";

test("variantCount is 4 or the model's max, whichever is smaller", () => {
  assert.equal(VARIANTS_PER_PROMPT, 4);
  assert.equal(variantCount(10), 4);
  assert.equal(variantCount(4), 4);
  assert.equal(variantCount(2), 2);
  assert.equal(variantCount(1), 1);
  assert.equal(variantCount(0), 1);
});

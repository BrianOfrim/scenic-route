import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VARIANTS, MAX_VARIANTS, clampVariants, variantCount } from "./poster";

test("clampVariants keeps requests in 1–10 and defaults to 4", () => {
  assert.equal(DEFAULT_VARIANTS, 4);
  assert.equal(MAX_VARIANTS, 10);
  assert.equal(clampVariants(undefined), 4);
  assert.equal(clampVariants(4), 4);
  assert.equal(clampVariants(0), 1);
  assert.equal(clampVariants(99), 10);
});

test("variantCount is the request or the model's max, whichever is smaller", () => {
  assert.equal(variantCount(4, 10), 4);
  assert.equal(variantCount(8, 10), 8);
  assert.equal(variantCount(4, 1), 1);
  assert.equal(variantCount(undefined, 10), 4);
  assert.equal(variantCount(0, 2), 1);
});

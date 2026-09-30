import assert from "node:assert/strict";
import { test } from "node:test";
import { locationCaption, reverseLocation } from "./location";

test("location caption selects settlement, region and country without street details", () => {
  assert.equal(locationCaption({ city: "Vancouver", state: "British Columbia", country: "Canada", road: "Main Street", postcode: "123" }), "Vancouver · British Columbia · Canada");
  assert.equal(locationCaption({ village: "Canmore", state: "Alberta", country: "Canada" }), "Canmore · Alberta · Canada");
  assert.equal(locationCaption({ city: "Singapore", country: "Singapore" }), "Singapore");
  assert.equal(locationCaption({ country: "Canada" }), "Canada");
  assert.equal(locationCaption({ city: 4, state: null }), "");
});

test("reverse lookup shares requests and fails gracefully", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("zoom"), "10");
    return new Response(JSON.stringify({ address: { city: "Vancouver", country: "Canada" } }));
  };
  try {
    assert.deepEqual(await Promise.all([reverseLocation(49.2827, -123.1207), reverseLocation(49.2827, -123.1207)]), ["Vancouver · Canada", "Vancouver · Canada"]);
    assert.equal(calls, 1);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await reverseLocation(51.05, -114.06), "");
  } finally { globalThis.fetch = original; }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODIFY_SOURCE_RULE,
  buildModifyMessages,
  withModifySourceRule,
  type ModifyPromptInput,
} from "./modifyPrompt";

const input: ModifyPromptInput = {
  imageUrl: "data:image/png;base64,aaaa",
  previousPrompt: "Swiss modernist map poster. Trace the GPS track exactly.",
  request: "Make the title larger and warm the paper.",
};

test("buildModifyMessages sends the poster, previous prompt, and request", () => {
  const messages = buildModifyMessages(input);
  assert.equal(messages.length, 2);
  assert.match(String(messages[0].content), /current poster as image 1/);
  assert.match(String(messages[0].content), /complete replacement prompt/);
  assert.match(String(messages[0].content), /do not invent place names/i);
  assert.match(String(messages[0].content), /16% of the poster width/);
  assert.match(String(messages[0].content), /clearly readable when the whole poster is viewed on a phone/);
  assert.match(String(messages[0].content), /Do not add a title when the design has none/);

  const user = messages[1].content;
  assert.ok(Array.isArray(user));
  const text = user.find((part) => part && typeof part === "object" && part.type === "text");
  const image = user.find((part) => part && typeof part === "object" && part.type === "image_url");
  assert.ok(text && typeof text.text === "string");
  assert.match(text.text, /Previous prompt:/);
  assert.match(text.text, /Swiss modernist map poster/);
  assert.match(text.text, /Requested change:/);
  assert.match(text.text, /Make the title larger/);
  assert.deepEqual(image, { type: "image_url", image_url: { url: input.imageUrl } });
});

test("withModifySourceRule prefixes once", () => {
  const revised = "Warm cream paper. Larger title.";
  const once = withModifySourceRule(revised);
  assert.ok(once.startsWith(MODIFY_SOURCE_RULE));
  assert.match(once, /Warm cream paper/);
  assert.equal(withModifySourceRule(once), once);
  assert.equal(withModifySourceRule("  "), "");
});

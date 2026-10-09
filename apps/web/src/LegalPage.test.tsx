import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalPage, legalDocumentPath } from "./LegalPage";

test("public policy routes accept trailing slashes without catching unrelated routes", () => {
  for (const path of ["/terms", "/terms/"]) assert.equal(legalDocumentPath(path), "terms");
  for (const path of ["/privacy", "/privacy/"]) assert.equal(legalDocumentPath(path), "privacy");
  for (const path of ["/", "/terms-extra", "/privacy/settings", "/reset-password"]) assert.equal(legalDocumentPath(path), null);
});

for (const file of ["terms-of-service", "privacy-policy"]) {
  test(`${file} renders source headings, draft status, and links`, () => {
    const document = readFileSync(new URL(`../../../docs/${file}.md`, import.meta.url), "utf8");
    const html = renderToStaticMarkup(<LegalPage document={document} />);
    assert.equal((html.match(/<h1/g) ?? []).length, 1);
    assert.equal((html.match(/<h2/g) ?? []).length, (document.match(/^## /gm) ?? []).length);
    assert.ok(html.includes('href="#policy-content"'));
    assert.ok(html.includes('aria-labelledby="policy-title"'));
    assert.ok(html.includes('aria-label="Draft status"'));
    assert.ok(html.includes("Not yet effective"));
    assert.ok(html.includes('href="mailto:info@scenic-route.ca"'));
    assert.ok(html.includes('href="/terms"'));
    assert.ok(html.includes('href="/privacy"'));
    assert.ok(!html.includes("[info@"));
  });
}

test("renderer escapes HTML and does not activate unsafe links", () => {
  const html = renderToStaticMarkup(<LegalPage document={'# Test\n\n<script>alert(1)</script> [bad](javascript:alert) [bad](//evil.example)'} />);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="//evil'));
});

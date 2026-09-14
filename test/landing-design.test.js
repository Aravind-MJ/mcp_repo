import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_HTML } from "../src/landing.js";

const entryPattern = /<article\b[^>]*data-mcp-entry="([^"]+)"[\s\S]*?<\/article>/g;

test("landing page has one complete entry for each MCP", () => {
  const entries = [...LANDING_HTML.matchAll(entryPattern)];
  assert.deepEqual(entries.map((match) => match[1]), ["artifact", "questionnaire"]);
  assert.equal(entries.length, 2);

  const [artifact, questionnaire] = entries.map((match) => match[0]);
  for (const [entry, expectations] of [
    [artifact, ["HTML Artifact Publisher", "Bearer protected", "5 tools", "/artifact/mcp", "/artifact", "/artifact/README.md", "/artifact/SKILL.md"]],
    [questionnaire, ["Questionnaire Collector", "Bearer protected", "11 tools", "/questionnaire/mcp", "/questionnaire", "/questionnaire/README.md", "/questionnaire/SKILL.md"]],
  ]) {
    for (const expected of expectations) assert.ok(entry.includes(expected), `entry includes ${expected}`);
    assert.equal((entry.match(/<h2\b/g) || []).length, 1);
    assert.match(entry, /Streamable HTTP endpoint/);
    assert.match(entry, /<span class="method">POST<\/span>/);
  }
});

test("landing page is self-contained, semantic, and responsive", () => {
  assert.match(LANDING_HTML, /^<!doctype html>/i);
  assert.equal((LANDING_HTML.match(/<h1\b/g) || []).length, 1);
  assert.equal((LANDING_HTML.match(/<main\b/g) || []).length, 1);
  assert.equal((LANDING_HTML.match(/<article\b/g) || []).length, 2);
  assert.match(LANDING_HTML, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(LANDING_HTML, /<link rel="icon" href="\/hub\.svg" type="image\/svg\+xml">/);
  assert.match(LANDING_HTML, /<img src="\/hub\.svg"[^>]+alt="">/);
  assert.match(LANDING_HTML, /class="skip-link" href="#mcp-registry"/);
  assert.match(LANDING_HTML, /@media \(max-width: 36rem\)/);
  assert.match(LANDING_HTML, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(LANDING_HTML, /overflow-wrap: anywhere/);
  assert.doesNotMatch(LANDING_HTML, /<(?:script\b|link[^>]+rel="stylesheet")|@import|fonts\.google|https?:\/\//i);
  assert.doesNotMatch(LANDING_HTML, /Shared MCP authentication/);
  assert.doesNotMatch(LANDING_HTML, /shared bearer credential/i);
});

test("landing links resolve to declared local resources", () => {
  const hrefs = [...LANDING_HTML.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs.filter((href) => href.endsWith("README.md")), [
    "/artifact/README.md",
    "/questionnaire/README.md",
  ]);
  assert.deepEqual(hrefs.filter((href) => href.endsWith("SKILL.md")), [
    "/artifact/SKILL.md",
    "/questionnaire/SKILL.md",
  ]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

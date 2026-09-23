import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_HTML } from "../src/landing.js";

const entryPattern = /<article\b[^>]*data-mcp-entry="([^"]+)"[\s\S]*?<\/article>/g;

const dashboards = {
  artifact: { href: "/artifacts", text: "https://mcp.aravindmj.in/artifacts" },
  questionnaire: { href: "/questionnaires", text: "https://mcp.aravindmj.in/questionnaires" },
  jev: { href: "/jev/logs", text: "https://mcp.aravindmj.in/jev/logs" },
};
const dashboardHref = /^\/(?:artifacts|questionnaires|jev\/logs)(?:[/?#]|$)/;
const dashboardUrl = /(?:https?:\/\/)?mcp\.aravindmj\.in\/(?:artifacts|questionnaires|jev\/logs)[^\s"<]*/g;
const dashboardUrls = (html) => [...html.matchAll(dashboardUrl)].map(([url]) => url);

function dashboardLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map(([, attributes, content]) => ({ href: attributes.match(/\bhref="([^"]*)"/)?.[1] ?? "", text: content.replace(/<[^>]*>/g, "").trim() }))
    .filter(({ href, text }) => dashboardHref.test(href) || dashboardUrls(text).length > 0);
}

test("landing page has one complete entry for each MCP", () => {
  const entries = [...LANDING_HTML.matchAll(entryPattern)];
  assert.deepEqual(entries.map((match) => match[1]), ["artifact", "questionnaire", "jev"]);
  assert.equal(entries.length, 3);

  const [artifact, questionnaire, jev] = entries.map((match) => match[0]);
  for (const [entry, expectations] of [
    [artifact, ["HTML Artifact Publisher", "Bearer protected", "6 tools", "/artifact/mcp", "/artifact", "/artifact/README.md", "/artifact/SKILL.md"]],
    [questionnaire, ["Questionnaire Collector", "Bearer protected", "11 tools", "/questionnaire/mcp", "/questionnaire", "/questionnaire/README.md", "/questionnaire/SKILL.md"]],
    [jev, ["Jev Structured Decisions", "Bearer protected", "1 tool", "/jev/mcp", "/jev", "/jev/README.md", "/jev/SKILL.md"]],
  ]) {
    for (const expected of expectations) assert.ok(entry.includes(expected), `entry includes ${expected}`);
    assert.equal((entry.match(/<h2\b/g) || []).length, 1);
    assert.match(entry, /Streamable HTTP endpoint/);
    assert.match(entry, /<span class="method">POST<\/span>/);
  }
});

test("each landing entry shows only its own dashboard as a visible link", () => {
  for (const [entry, name] of LANDING_HTML.matchAll(entryPattern)) {
    const dashboard = dashboards[name];
    assert.deepEqual(dashboardLinks(entry), [dashboard], `${name} entry links exactly its own dashboard`);
    assert.deepEqual(dashboardUrls(entry), [dashboard.text], `${name} entry shows no other dashboard URL`);
    assert.match(entry, /<span class="endpoint-label dashboard-label">Dashboard · HTTP auth<\/span>\s*<a class="dashboard-link"/);
  }
  assert.deepEqual(dashboardLinks(LANDING_HTML), Object.values(dashboards));
});

test("landing page is self-contained, semantic, and responsive", () => {
  assert.match(LANDING_HTML, /^<!doctype html>/i);
  assert.equal((LANDING_HTML.match(/<h1\b/g) || []).length, 1);
  assert.equal((LANDING_HTML.match(/<main\b/g) || []).length, 1);
  assert.equal((LANDING_HTML.match(/<article\b/g) || []).length, 3);
  assert.match(LANDING_HTML, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(LANDING_HTML, /<link rel="icon" href="\/hub\.svg" type="image\/svg\+xml">/);
  assert.match(LANDING_HTML, /<img src="\/hub\.svg"[^>]+alt="">/);
  assert.match(LANDING_HTML, /class="skip-link" href="#mcp-registry"/);
  assert.match(LANDING_HTML, /@media \(max-width: 36rem\)/);
  assert.match(LANDING_HTML, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(LANDING_HTML, /overflow-wrap: anywhere/);
  assert.doesNotMatch(LANDING_HTML, /<(?:script\b|link[^>]+rel="stylesheet")|@import|fonts\.google|https?:\/\/(?!mcp\.aravindmj\.in\/(?:artifacts|questionnaires|jev\/logs)<\/a>)/i);
  assert.doesNotMatch(LANDING_HTML, /Shared MCP authentication/);
  assert.doesNotMatch(LANDING_HTML, /shared bearer credential/i);
});

test("landing links resolve to declared local resources", () => {
  const hrefs = [...LANDING_HTML.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs.filter((href) => href.endsWith("README.md")), [
    "/artifact/README.md",
    "/questionnaire/README.md",
    "/jev/README.md",
  ]);
  assert.deepEqual(hrefs.filter((href) => href.endsWith("SKILL.md")), [
    "/artifact/SKILL.md",
    "/questionnaire/SKILL.md",
    "/jev/SKILL.md",
  ]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

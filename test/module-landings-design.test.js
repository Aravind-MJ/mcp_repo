import assert from "node:assert/strict";
import test from "node:test";
import { ARTIFACT_LANDING_HTML, JEV_LANDING_HTML, QUESTIONNAIRE_LANDING_HTML } from "../src/module-landings.js";

const pages = [
  {
    name: "artifact",
    html: ARTIFACT_LANDING_HTML,
    title: "HTML Artifact Publisher",
    favicon: "/favicon.svg",
    mark: "/logo.svg",
    endpoint: "/artifact/mcp",
    guide: "/artifact/README.md",
    skill: "/artifact/SKILL.md",
    serverName: "aravind_html_publisher",
    toolCount: 6,
    authCopy: "Bearer authentication required",
    dashboard: { href: "/artifacts", text: "https://mcp.aravindmj.in/artifacts" },
  },
  {
    name: "questionnaire",
    html: QUESTIONNAIRE_LANDING_HTML,
    title: "Questionnaire Collector",
    favicon: "/questionnaire.svg?v=20260911-modules1",
    mark: "/questionnaire.svg?v=20260911-modules1",
    endpoint: "/questionnaire/mcp",
    guide: "/questionnaire/README.md",
    skill: "/questionnaire/SKILL.md",
    serverName: "aravind_questionnaires",
    toolCount: 11,
    authCopy: "Bearer authentication required",
    dashboard: { href: "/questionnaires", text: "https://mcp.aravindmj.in/questionnaires" },
  },
  {
    name: "jev",
    html: JEV_LANDING_HTML,
    title: "Jev Structured Decisions",
    favicon: "/jev.svg",
    mark: "/jev.svg",
    endpoint: "/jev/mcp",
    guide: "/jev/README.md",
    skill: "/jev/SKILL.md",
    serverName: "aravind_jev_decisions",
    toolCount: 1,
    authCopy: "Bearer authentication required",
    dashboard: { href: "/jev/logs", text: "https://mcp.aravindmj.in/jev/logs" },
  },
];

const dashboardHref = /^\/(?:artifacts|questionnaires|jev\/logs)(?:[/?#]|$)/;
const dashboardUrl = /(?:https?:\/\/)?mcp\.aravindmj\.in\/(?:artifacts|questionnaires|jev\/logs)[^\s"<]*/g;
const dashboardUrls = (html) => [...html.matchAll(dashboardUrl)].map(([url]) => url);

function dashboardLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map(([, attributes, content]) => ({ href: attributes.match(/\bhref="([^"]*)"/)?.[1] ?? "", text: content.replace(/<[^>]*>/g, "").trim() }))
    .filter(({ href, text }) => dashboardHref.test(href) || dashboardUrls(text).length > 0);
}

for (const page of pages) {
  test(`${page.name} landing is a complete self-contained module page`, () => {
    assert.match(page.html, /^<!doctype html>/i);
    assert.match(page.html, new RegExp(`<html lang="en" data-module="${page.name}">`));
    assert.equal((page.html.match(/<h1\b/g) || []).length, 1);
    assert.equal((page.html.match(/<h2\b/g) || []).length, 2);
    assert.match(page.html, new RegExp(`<h1[^>]*>${page.title}<\\/h1>`));
    assert.match(page.html, new RegExp(page.authCopy));
    assert.ok(page.html.includes(page.endpoint));
    assert.ok(page.html.includes(page.serverName));
    assert.equal((page.html.match(/<li class="tool">/g) || []).length, page.toolCount);
    assert.match(page.html, new RegExp(`>${page.toolCount} tool${page.toolCount === 1 ? "" : "s"}<`));
    assert.match(page.html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
    assert.match(page.html, /class="skip-link" href="#main-content"/);
    assert.match(page.html, /@media \(max-width: 38rem\)/);
    assert.match(page.html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(page.html, /overflow-wrap: anywhere/);
    assert.doesNotMatch(page.html, /<(?:script\b|link[^>]+rel="stylesheet")|@import|fonts\.google/i);

    const hrefs = [...page.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(hrefs.includes("/"));
    assert.ok(hrefs.includes(page.guide));
    assert.ok(hrefs.includes(page.skill));

    const connectionDetails = page.html.match(/<aside class="hero-aside" aria-label="Connection details">[\s\S]*?<\/aside>/)[0];
    assert.deepEqual(dashboardLinks(page.html), [page.dashboard], `${page.name} page links exactly its own dashboard`);
    assert.deepEqual(dashboardLinks(connectionDetails), [page.dashboard], `${page.name} dashboard sits with the connection details`);
    assert.deepEqual(dashboardUrls(page.html), [page.dashboard.text], `${page.name} page shows no other dashboard URL`);
    assert.match(connectionDetails, /<div class="endpoint"><span>Dashboard · HTTP auth<\/span><a class="dashboard-link"/);

    const faviconPattern = page.favicon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const markPattern = page.mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(page.html, new RegExp(`<link rel="icon" href="${faviconPattern}"`));
    assert.match(page.html, new RegExp(`<img src="${markPattern}"[^>]+alt="">`));
  });
}

test("the longer questionnaire title has a dedicated narrow-screen scale", () => {
  assert.match(QUESTIONNAIRE_LANDING_HTML, /html\[data-module="questionnaire"\] h1 \{ font-size: clamp\(3rem, 14vw, 4\.5rem\); \}/);
});

test("artifact landing states the signed-link and sandbox trust boundaries", () => {
  assert.match(ARTIFACT_LANDING_HTML, /shared bearer credential/);
  assert.match(ARTIFACT_LANDING_HTML, /valid signed URL or owner Basic Auth/);
  assert.match(ARTIFACT_LANDING_HTML, /Anyone holding an unexpired link can view it/);
  assert.match(ARTIFACT_LANDING_HTML, /restrictive CSP sandbox/);
  assert.match(ARTIFACT_LANDING_HTML, /Never publish secrets or private data/);
});

test("questionnaire landing avoids repeating the authentication status in a trust note", () => {
  assert.doesNotMatch(QUESTIONNAIRE_LANDING_HTML, /questionnaire-trust-title/);
  assert.doesNotMatch(QUESTIONNAIRE_LANDING_HTML, /Authenticated control plane/);
  assert.match(QUESTIONNAIRE_LANDING_HTML, /closing a questionnaire prevents new saves but retains stored responses/);
  assert.doesNotMatch(QUESTIONNAIRE_LANDING_HTML, /anonymous responses|responses are anonymous/i);
});

test("access boundaries precede installation actions", () => {
  assert.ok(ARTIFACT_LANDING_HTML.indexOf('role="note"') > 0);
  assert.ok(ARTIFACT_LANDING_HTML.indexOf('role="note"') < ARTIFACT_LANDING_HTML.indexOf('<nav class="actions"'));
  assert.match(ARTIFACT_LANDING_HTML, /https:\/\/mcp\.aravindmj\.in\/artifact\/mcp/);
  assert.match(QUESTIONNAIRE_LANDING_HTML, /https:\/\/mcp\.aravindmj\.in\/questionnaire\/mcp/);
});

test("questionnaire tools are grouped by lifecycle", () => {
  for (const label of ["Define", "Distribute &amp; operate", "Review responses", "Permanent deletion"]) {
    assert.match(QUESTIONNAIRE_LANDING_HTML, new RegExp(`>${label}<\\/h3>`));
  }
});

const artifactTools = ["get_attachment_upload_url", "publish_html", "update_artifact", "get_signed_url", "list_artifacts", "delete_artifact"];
const questionnaireTools = ["create_questionnaire", "update_questionnaire", "get_questionnaire", "list_questionnaires", "get_questionnaire_signed_url", "submit_questionnaire_response", "set_questionnaire_status", "delete_questionnaire", "list_questionnaire_responses", "get_questionnaire_response", "delete_questionnaire_response"];
const jevTools = ["make_decisions"];

test("module landing tool registries match the exact MCP tools", () => {
  for (const tool of artifactTools) assert.match(ARTIFACT_LANDING_HTML, new RegExp(`<code>${tool}<\\/code>`));
  for (const tool of questionnaireTools) assert.match(QUESTIONNAIRE_LANDING_HTML, new RegExp(`<code>${tool}<\\/code>`));
  for (const tool of jevTools) assert.match(JEV_LANDING_HTML, new RegExp(`<code>${tool}<\\/code>`));
});

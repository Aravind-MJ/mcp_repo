import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { createQuestionnaireSignedUrl } from "../src/security.js";

let root;
let server;
let baseUrl;
let config;
let store;

const questions = [
  { id: "name", type: "short_text", title: "Your name", required: true, placeholder: "Ada Lovelace" },
  { id: "story", type: "long_text", title: "Your story" },
  { id: "email", type: "email", title: "Email" },
  { id: "site", type: "url", title: "Website" },
  { id: "phone", type: "phone", title: "Phone" },
  { id: "age", type: "number", title: "Age", validation: { min: 18, max: 120 } },
  { id: "date", type: "date", title: "Date" },
  { id: "time", type: "time", title: "Time" },
  { id: "meeting", type: "datetime", title: "Meeting" },
  { id: "plan", type: "single_choice", title: "Plan", required: true, options: [{ value: "starter", label: "Starter" }, { value: "pro", label: "Pro" }] },
  { id: "topics", type: "multiple_choice", title: "Topics", required: true, options: [{ value: "api", label: "API" }, { value: "ui", label: "UI" }] },
  { id: "country", type: "dropdown", title: "Country", options: [{ value: "in", label: "India" }, { value: "uk", label: "United Kingdom" }] },
  { id: "recommend", type: "yes_no", title: "Recommend?" },
  { id: "consent", type: "consent", title: "I agree" },
  { id: "rating", type: "rating", title: "Rating", settings: { max: 5, icon: "star" } },
  { id: "score", type: "scale", title: "Score", settings: { min: 0, max: 10, min_label: "Low", max_label: "High" } },
  { id: "priority", type: "ranking", title: "Rank", required: true, options: [{ value: "speed", label: "Speed" }, { value: "quality", label: "Quality" }] },
  { id: "matrix", type: "matrix", title: "Evaluate", rows: [{ value: "docs", label: "Documentation" }], options: [{ value: "poor", label: "Poor" }, { value: "great", label: "Great" }] },
];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-http-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "s".repeat(64), { mode: 0o600 });
  config = {
    host: "127.0.0.1", port: 0, dataDir: path.join(root, "data"), secretFile,
    publicBaseUrl: "https://mcp.example.test", maxHtmlBytes: 1024, maxListItems: 200,
    maxQuestionnaires: 500, maxQuestions: 200, maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  };
  const created = await createApp(config);
  store = created.questionnaireStore;
  server = createServer(created.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  store?.close();
  await rm(root, { recursive: true, force: true });
});

function localUrl(publicUrl) {
  return publicUrl.replace(config.publicBaseUrl, baseUrl);
}

function subresourceUrl(signedUrl, suffix) {
  const source = new URL(localUrl(signedUrl));
  const target = new URL(`${source.pathname}${suffix}`, baseUrl);
  target.search = source.search;
  return target.toString();
}

test("rejects unapproved Host headers before serving public or MCP routes", async () => {
  const target = new URL(baseUrl);
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: "/healthz",
      headers: { host: "attacker.example" },
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(response.status, 403);
  assert.match(response.body, /Invalid Host/);
});

test("renders a secure, responsive questionnaire UI for every supported answer type", async () => {
  const questionnaire = store.create({ title: "Product discovery", description: "Help us build the right thing.", questions, settings: { accent_color: "#ff5c35", completion_message: "You made our day." } });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const response = await fetch(localUrl(signed.url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'nonce-[A-Za-z0-9+/=]+'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /<title>Product discovery<\/title>/);
  assert.match(html, /Help us build the right thing/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-autosave-state/);
  assert.match(html, /sessionStorage/);
  assert.doesNotMatch(html, /localStorage/);
  assert.match(html, /function sessionGet\(key\) \{ try \{ return window\.sessionStorage\.getItem\(key\); \} catch \{ return null; \} \}/);
  assert.match(html, /function sessionSet\(key, value\) \{ try \{ window\.sessionStorage\.setItem\(key, value\); \} catch \{ return false; \} return true; \}/);
  assert.match(html, /function sessionRemove\(key\) \{ try \{ window\.sessionStorage\.removeItem\(key\); \} catch \{ return false; \} return true; \}/);
  assert.doesNotMatch(html, /(?<!window\.)sessionStorage\.(?:getItem|setItem|removeItem)/);
  assert.match(html, /pagehide/);
  assert.match(html, /keepalive: true/);
  assert.match(html, /let changeVersion = 0/);
  assert.match(html, /const savingVersion = changeVersion/);
  assert.match(html, /dirty = savedVersion !== changeVersion/);
  assert.match(html, /\[404, 410\]\.includes\(response\.status\)/);
  assert.match(html, /Draft restore temporarily unavailable/);
  assert.match(html, /const restoreVersion = changeVersion/);
  assert.match(html, /if \(changeVersion === restoreVersion\) hydrate/);
  assert.match(html, /let draftPromise = null/);
  assert.match(html, /await restoreDraft\(\)/);
  assert.match(html, /id="questionnaire-fields" disabled/);
  assert.match(html, /<form id="questionnaire-form" method="post"/);
  assert.match(html, /questionnaireFields\.disabled = false/);
  assert.match(html, /data-percent="0"/);
  assert.doesNotMatch(html, /progressBar\.style\.width/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /data-question-type="short_text"/);
  assert.match(html, /<textarea[^>]+name="story"/);
  assert.match(html, /type="email"[^>]+name="email"/);
  assert.match(html, /type="url"[^>]+name="site"/);
  assert.match(html, /type="tel"[^>]+name="phone"/);
  assert.match(html, /type="number"[^>]+name="age"/);
  assert.match(html, /type="date"[^>]+name="date"/);
  assert.match(html, /type="time"[^>]+name="time"/);
  assert.match(html, /type="datetime-local"[^>]+name="meeting"/);
  assert.match(html, /type="radio"[^>]+name="plan"/);
  assert.match(html, /type="checkbox"[^>]+name="topics"/);
  assert.match(html, /<select[^>]+name="country"/);
  assert.match(html, /name="recommend" value="yes"/);
  assert.match(html, /name="consent"/);
  assert.match(html, /data-rating/);
  assert.match(html, /data-scale/);
  assert.match(html, /data-ranking/);
  assert.match(html, /data-ranking-answered="false"/);
  assert.match(html, /data-ranking-required="true"/);
  assert.match(html, /ranking\.dataset\.rankingAnswered = "true"/);
  assert.match(html, /const selectionsValid = validateSelections\(\)/);
  assert.match(html, /\.option-card:has\(input:focus-visible\)/);
  assert.match(html, /aria-labelledby="question-title-name"/);
  assert.match(html, /aria-describedby="question-error-name"/);
  assert.match(html, /id="question-error-name"/);
  assert.match(html, /role="group" aria-labelledby="question-title-topics"/);
  assert.match(html, /data-multiple-choice="topics"[^>]+aria-labelledby="question-title-topics"/);
  assert.match(html, /data-ranking="priority"[^>]+aria-labelledby="question-title-priority"/);
  assert.doesNotMatch(html, /role="group"[^>]+aria-required/);
  assert.match(html, /<span class="sr-only"> \(Required\)<\/span>/);
  assert.match(html, /validateScalarPatterns/);
  assert.match(html, /https\?:/);
  assert.match(html, /firstInvalid/);
  assert.doesNotMatch(html, /flex-direction:row-reverse/);
  assert.match(html, /\.rating\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /\.scale-options\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /\.matrix-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(html, /\.matrix th:first-child\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /data-ranking-status/);
  assert.match(html, /\.disabled = index ===/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /Answers are anonymous|No account or personal identifier is collected|saved in this browser/);
  assert.match(html, /No account required/);
  assert.match(html, /name="respondent_name"/);
  assert.match(html, /name="respondent_email"/);
  assert.match(html, /Your identity is attached only when you submit/);
  assert.match(html, /saved to the server while you are online/);
  assert.match(html, /<table class="matrix"/);
  assert.match(html, /You made our day/);
  assert.doesNotMatch(html, /response_counts|revision_created_at|updated_at|created_at/);
  assert.doesNotMatch(html, /<script src=/);
  const nonce = response.headers.get("content-security-policy").match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`));
});

test("renders conditional children as accessible nested questions and clamps the full-width introduction", async () => {
  const questionnaire = store.create({
    title: "Nested decisions",
    description: "First paragraph.\n\nSecond paragraph with enough context to occupy the available width while remaining visually bounded.",
    questions: [{
      id: "decision",
      type: "single_choice",
      title: "Keep the current rule?",
      required: true,
      options: [{ value: "keep", label: "Keep it" }, { value: "change", label: "Change it" }],
      children: [{ id: "detail", type: "long_text", title: "What should change?", required: true, show_when: ["change"] }],
    }],
  });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const response = await fetch(localUrl(signed.url));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /class="document-description hero-description"/);
  assert.doesNotMatch(html, /Response form · Revision|Revision 1/);
  assert.match(html, /<details class="introduction">/);
  assert.match(html, /\.hero-description\s*\{[^}]*-webkit-line-clamp:\s*5/);
  assert.match(html, /\.nested-question \.nested-questions\s*\{[^}]*padding:\s*0/);
  assert.match(html, /\.nested-question \.nested-question\s*\{[^}]*padding:\s*18px 0 0/);
  assert.match(html, /data-question-depth="1"/);
  assert.match(html, /data-question-depth="2"/);
  assert.match(html, /data-parent-question="decision"/);
  assert.match(html, /data-show-when="[^"]+"/);
  assert.match(html, /class="nested-questions"/);
  assert.match(html, /id="question-detail"[^>]+hidden/);
  assert.match(html, /function flattenQuestions/);
  assert.match(html, /function activeQuestions/);
  assert.match(html, /function updateVisibility/);
  assert.match(html, /card\.hidden = !visible/);
  assert.match(html, /control\.disabled = !visible/);
  assert.match(html, /const visibleQuestions = activeQuestions\(answers\)/);
  assert.match(html, /<span>1 main question<\/span>/);
  assert.equal((html.match(/<a href="#question-[^"]+" data-question-link=/g) || []).length, 1);
});

test("enforces nested branch requirements through public response APIs", async () => {
  const questionnaire = store.create({
    title: "Nested response API",
    questions: [{
      id: "decision",
      type: "single_choice",
      title: "Choose",
      required: true,
      options: [{ value: "keep", label: "Keep" }, { value: "change", label: "Change" }],
      children: [{ id: "detail", type: "long_text", title: "Explain", required: true, show_when: ["change"] }],
    }],
  });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const create = await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const draft = await create.json();
  const headers = { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token };
  const submitUrl = subresourceUrl(signed.url, `/responses/${draft.response_id}/submit`);

  const missing = await fetch(submitUrl, { method: "POST", headers, body: JSON.stringify({ answers: { decision: "change" }, version: 0 }) });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /detail.*required/);
  const submitted = await fetch(submitUrl, { method: "POST", headers, body: JSON.stringify({ answers: { decision: "keep", detail: "Discard me" }, respondent: { name: "Ada Lovelace", email: "ada@example.com" }, version: 0 }) });
  assert.equal(submitted.status, 200);
  assert.deepEqual((await submitted.json()).answers, { decision: "keep" });
});

test("requires an unexpired exact-revision signature for pages and response APIs", async () => {
  const questionnaire = store.create({ title: "Signed", questions: questions.slice(0, 2) });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const parsed = new URL(localUrl(signed.url));
  assert.equal((await fetch(`${baseUrl}${parsed.pathname}`)).status, 404);

  const tampered = new URL(parsed);
  tampered.searchParams.set("signature", "0".repeat(64));
  assert.equal((await fetch(tampered)).status, 404);

  const wrongRevision = new URL(parsed);
  wrongRevision.pathname = wrongRevision.pathname.replace("/r/1", "/r/2");
  assert.equal((await fetch(wrongRevision)).status, 404);

  const expired = await createQuestionnaireSignedUrl({ questionnaireId: questionnaire.questionnaire_id, revision: 1, publicBaseUrl: baseUrl, secretFile: config.secretFile, expiresInSeconds: 60, nowSeconds: Math.floor(Date.now() / 1000) - 120 });
  assert.equal((await fetch(expired.url)).status, 404);
  assert.equal((await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 201);
  assert.equal((await fetch(`${baseUrl}${parsed.pathname}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
});

test("creates, resumes, and autosaves anonymously, then requires identity to submit", async () => {
  const questionnaire = store.create({ title: "Response flow", questions: [questions[0], questions[9]] });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const createdResponse = await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(createdResponse.status, 201);
  const draft = await createdResponse.json();
  assert.match(draft.response_id, /^[A-Za-z0-9]{24}$/);
  assert.match(draft.edit_token, /^[a-f0-9]{64}$/);

  const editHeaders = { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token };
  const responseUrl = subresourceUrl(signed.url, `/responses/${draft.response_id}`);
  const saved = await fetch(responseUrl, { method: "PATCH", headers: editHeaders, body: JSON.stringify({ answers: { name: "Aravind" } }) });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.answers.name, "Aravind");
  assert.equal(savedBody.version, 1);

  const stale = await fetch(responseUrl, { method: "PATCH", headers: editHeaders, body: JSON.stringify({ answers: { name: "Overwritten" }, version: 0 }) });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /changed in another tab/i);

  const resumed = await fetch(responseUrl, { headers: { "x-questionnaire-edit-token": draft.edit_token } });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).answers.name, "Aravind");
  assert.equal((await fetch(responseUrl, { headers: { "x-questionnaire-edit-token": "0".repeat(64) } })).status, 404);

  const incomplete = await fetch(`${responseUrl.replace(/\?.*$/, "")}/submit${new URL(responseUrl).search}`, { method: "POST", headers: editHeaders, body: JSON.stringify({ answers: { name: "Aravind" } }) });
  assert.equal(incomplete.status, 400);
  assert.match((await incomplete.json()).error, /plan/);

  const submitUrl = subresourceUrl(signed.url, `/responses/${draft.response_id}/submit`);
  const unidentified = await fetch(submitUrl, { method: "POST", headers: editHeaders, body: JSON.stringify({ answers: { name: "Aravind", plan: "pro" } }) });
  assert.equal(unidentified.status, 400);
  assert.match((await unidentified.json()).error, /respondent.*required/i);
  const submitted = await fetch(submitUrl, { method: "POST", headers: editHeaders, body: JSON.stringify({ answers: { name: "Aravind", plan: "pro" }, respondent: { name: "Aravind M J", email: "aravind@example.com" } }) });
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  assert.equal(submittedBody.status, "submitted");
  assert.deepEqual(submittedBody.respondent, { name: "Aravind M J", email: "aravind@example.com" });
  assert.equal(store.listResponses(questionnaire.questionnaire_id, { status: "submitted" }).total, 1);
  assert.equal((await fetch(responseUrl, { method: "PATCH", headers: editHeaders, body: JSON.stringify({ answers: { name: "Changed" } }) })).status, 409);
});

test("returns a bounded client error for oversized autosave bodies", async () => {
  const questionnaire = store.create({ title: "Size bound", questions: questions.slice(0, 2) });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const create = await fetch(subresourceUrl(signed.url, "/responses"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const draft = await create.json();
  const oversized = await fetch(subresourceUrl(signed.url, `/responses/${draft.response_id}`), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token },
    body: JSON.stringify({ answers: { name: "x".repeat(config.maxAnswerBytes + 20_000) } }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "Request body exceeds the storage limit" });
});

test("revisionless signed URLs follow the latest revision while exact URLs remain immutable", async () => {
  const questionnaire = store.create({ title: "Latest one", questions: questions.slice(0, 2) });
  const latest = await store.createSignedUrl(questionnaire.questionnaire_id);
  const exactOne = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const loadedBeforeUpdate = await (await fetch(localUrl(latest.url))).text();
  const loadedDefinition = JSON.parse(loadedBeforeUpdate.match(/<script type="application\/json" id="questionnaire-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(loadedDefinition.response_scope.revision, 1);
  store.update(questionnaire.questionnaire_id, { title: "Latest two" });

  const latestPage = await fetch(localUrl(latest.url));
  const latestHtml = await latestPage.text();
  assert.equal(latestPage.status, 200);
  assert.match(latestHtml, /Latest two/);
  assert.doesNotMatch(latestHtml, /Latest one/);

  const exactHtml = await (await fetch(localUrl(exactOne.url))).text();
  assert.match(exactHtml, /Latest one/);
  assert.doesNotMatch(exactHtml, /Latest two/);

  const latestAsExact = new URL(localUrl(latest.url));
  latestAsExact.pathname += "/r/2";
  assert.equal((await fetch(latestAsExact)).status, 404);
  const exactAsLatest = new URL(localUrl(exactOne.url));
  exactAsLatest.pathname = `/questionnaire/${questionnaire.questionnaire_id}`;
  assert.equal((await fetch(exactAsLatest)).status, 404);

  const loadedAfterUpdate = JSON.parse(latestHtml.match(/<script type="application\/json" id="questionnaire-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(loadedAfterUpdate.response_scope.revision, 2);

  const scopedUrl = (scope, suffix) => {
    const url = new URL(subresourceUrl(latest.url, suffix));
    url.searchParams.set("response_revision", String(scope.revision));
    url.searchParams.set("response_signature", scope.signature);
    return url;
  };
  const created = await fetch(scopedUrl(loadedDefinition.response_scope, "/responses"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(created.status, 201);
  const draft = await created.json();
  assert.equal(store.getResponse(questionnaire.questionnaire_id, draft.response_id).revision, 1);
  const saved = await fetch(scopedUrl(loadedDefinition.response_scope, `/responses/${draft.response_id}`), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token },
    body: JSON.stringify({ answers: { name: "Still on one" }, version: 0 }),
  });
  assert.equal(saved.status, 200);

  const currentDraftResponse = await fetch(scopedUrl(loadedAfterUpdate.response_scope, "/responses"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const currentDraft = await currentDraftResponse.json();
  assert.equal(store.getResponse(questionnaire.questionnaire_id, currentDraft.response_id).revision, 2);

  const tamperedScope = scopedUrl(loadedDefinition.response_scope, "/responses");
  tamperedScope.searchParams.set("response_revision", "2");
  assert.equal((await fetch(tamperedScope, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
});

test("keeps earlier revision links immutable and prevents writes while closed", async () => {
  const questionnaire = store.create({ title: "Revision one", questions: questions.slice(0, 2) });
  const revisionOne = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  store.update(questionnaire.questionnaire_id, { title: "Revision two" });
  const html = await (await fetch(localUrl(revisionOne.url))).text();
  assert.match(html, /Revision one/);
  assert.doesNotMatch(html, /Revision two/);

  store.setStatus(questionnaire.questionnaire_id, "closed");
  const closedPage = await fetch(localUrl(revisionOne.url));
  assert.equal(closedPage.status, 200);
  assert.match(await closedPage.text(), /This questionnaire is closed/);
  const createResponse = await fetch(subresourceUrl(revisionOne.url, "/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(createResponse.status, 409);
});

test("serves a public secret-free questionnaire install guide and companion skill", async () => {
  const landing = await fetch(`${baseUrl}/questionnaire`);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get("content-security-policy"), /img-src 'self'/);
  const landingHtml = await landing.text();
  assert.match(landingHtml, /Questionnaire Collector/);
  assert.match(landingHtml, /Bearer authentication required/);
  assert.doesNotMatch(landingHtml, /Authenticated control plane/);
  assert.match(landingHtml, /Read installation guide/);
  assert.doesNotMatch(landingHtml, /href="\/questionnaires/);

  const readme = await fetch(`${baseUrl}/questionnaire/README.md`);
  assert.equal(readme.status, 200);
  const readmeText = await readme.text();
  assert.match(readmeText, /aravind_questionnaires/);
  assert.match(readmeText, /Authorization: Bearer/);
  assert.match(readmeText, /credential provisioned by the service owner/);
  assert.doesNotMatch(readmeText, /Artifact Publisher/);
  assert.match(readmeText, /Harness-neutral self-installation/);
  assert.match(readmeText, /Identify the harness/);
  assert.match(readmeText, /update it in place instead of creating a duplicate/);
  assert.match(readmeText, /native user-level MCP configuration/);
  assert.match(readmeText, /Install the companion skill/);
  assert.match(readmeText, /create_questionnaire/);
  assert.match(readmeText, /submit_questionnaire_response/);
  assert.match(readmeText, /list_questionnaire_responses/);

  const skill = await fetch(`${baseUrl}/questionnaire/SKILL.md`);
  assert.equal(skill.status, 200);
  const skillText = await skill.text();
  assert.match(skillText, /^---\nname: aravind-questionnaire-collector/m);
  assert.match(skillText, /revisionless latest URL/);
  assert.match(skillText, /scope-bound and non-transferable/);
  assert.match(skillText, /`children`/);
  assert.match(skillText, /`show_when`/);
  assert.match(skillText, /submit_questionnaire_response/);
  assert.match(skillText, /respondent name and email/);
  assert.match(skillText, /credential provisioned by the service owner/);
  assert.doesNotMatch(skillText, /Artifact Publisher/);
  assert.doesNotMatch(skillText, /Bearer [A-Za-z0-9]{32}/);
});

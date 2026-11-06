import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";

let root;
let server;
let baseUrl;
let store;

const trustedHeaders = { "x-questionnaire-basic-auth": "1" };
const publicBaseUrl = "https://mcp.example.test";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-admin-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "s".repeat(64), { mode: 0o600 });
  const created = await createApp({
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(root, "data"),
    secretFile,
    publicBaseUrl,
    maxHtmlBytes: 1024,
    maxListItems: 200,
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  });
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

function form(body) {
  return {
    method: "POST",
    headers: { ...trustedHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    redirect: "manual",
  };
}

test("conceals the questionnaire index unless Caddy marks Basic Auth as trusted", async () => {
  assert.equal((await fetch(`${baseUrl}/questionnaires`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/questionnaires/example`)).status, 404);
});

test("renders a secure questionnaire index and manages share links and status", async () => {
  const questionnaire = store.create({
    title: '<script>alert("x")</script>',
    description: "Private inventory item",
    questions: [{ id: "name", type: "short_text", title: "Name", required: true }],
  });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Ada" });

  const response = await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-security-policy"), /script-src 'nonce-[A-Za-z0-9+/=]+'/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  const html = await response.text();
  assert.match(html, /Private index/);
  assert.match(html, /Questionnaires/);
  assert.match(html, new RegExp(`<a class="recent-link" href="/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}">`));
  assert.doesNotMatch(html, /Previous revisions|responses-table/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
  assert.match(html, new RegExp(`href="/questionnaires/${questionnaire.questionnaire_id}/responses"`));
  assert.match(html, new RegExp(`data-sign-questionnaire="${questionnaire.questionnaire_id}"`));
  assert.match(html, new RegExp(`action="/questionnaires/${questionnaire.questionnaire_id}/status"`));
  assert.match(html, new RegExp(`action="/questionnaires/${questionnaire.questionnaire_id}/delete"`));
  assert.match(html, /name="csrf_token" value="[a-f0-9]{64}"/);

  const signToken = html.match(new RegExp(`data-sign-questionnaire="${questionnaire.questionnaire_id}"[^>]+data-csrf-token="([a-f0-9]{64})"`))?.[1];
  assert.match(signToken, /^[a-f0-9]{64}$/);
  const signed = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/sign`, form({ csrf_token: signToken }));
  assert.equal(signed.status, 200);
  const signedBody = await signed.json();
  assert.match(signedBody.url, new RegExp(`/questionnaire/${questionnaire.questionnaire_id}\\?expires=\\d+&signature=[a-f0-9]{64}$`));
  assert.doesNotMatch(signedBody.url, /\/r\/1/);

  const statusToken = html.match(new RegExp(`action="/questionnaires/${questionnaire.questionnaire_id}/status"[\\s\\S]*?name="csrf_token" value="([a-f0-9]{64})"`))?.[1];
  assert.equal((await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/status`, form({ csrf_token: signToken, status: "closed" }))).status, 403);
  assert.equal((await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/status`, form({ csrf_token: "0".repeat(64), status: "closed" }))).status, 403);
  const statusChanged = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/status`, form({ csrf_token: statusToken, status: "closed" }));
  assert.equal(statusChanged.status, 303);
  assert.equal(statusChanged.headers.get("location"), "/questionnaires");
  assert.equal(store.get(questionnaire.questionnaire_id).status, "closed");
});

test("shows response answers privately and requires CSRF for destructive actions", async () => {
  const questionnaire = store.create({ authentication_type: "self_report",
    title: "Research intake",
    questions: [
      { id: "name", type: "short_text", title: "Name", required: true },
      { id: "plan", type: "single_choice", title: "Plan", options: [{ value: "pro", label: "Professional" }, { value: "basic", label: "Basic" }] },
    ],
  });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: '<img src=x onerror="alert(1)">', plan: "pro" }, { name: '<script>alert("identity")</script>', email: "ada@example.com" });

  const list = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses`, { headers: trustedHeaders });
  assert.equal(list.status, 200);
  const listHtml = await list.text();
  assert.match(listHtml, /Submitted/);
  assert.match(listHtml, /&lt;script&gt;alert\(&quot;identity&quot;\)&lt;\/script&gt;/);
  assert.match(listHtml, new RegExp(`href="/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}"`));

  const detail = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}`, { headers: trustedHeaders });
  assert.equal(detail.status, 200);
  const detailHtml = await detail.text();
  assert.match(detailHtml, /Professional/);
  assert.match(detailHtml, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(detailHtml, /&lt;script&gt;alert\(&quot;identity&quot;\)&lt;\/script&gt;/);
  assert.match(detailHtml, /ada@example\.com/);
  assert.doesNotMatch(detailHtml, /<img src=x/);
  assert.doesNotMatch(detailHtml, new RegExp(draft.edit_token));
  const responseDeleteToken = detailHtml.match(/name="csrf_token" value="([a-f0-9]{64})"/)?.[1];
  assert.match(responseDeleteToken, /^[a-f0-9]{64}$/);

  assert.equal((await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}/delete`, form({ csrf_token: "bad" }))).status, 403);
  const deletedResponse = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}/delete`, form({ csrf_token: responseDeleteToken }));
  assert.equal(deletedResponse.status, 303);
  assert.equal(deletedResponse.headers.get("location"), `/questionnaires/${questionnaire.questionnaire_id}/responses`);
  assert.throws(() => store.getResponse(questionnaire.questionnaire_id, draft.response_id), /Response not found/);

  const indexHtml = await (await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders })).text();
  const questionnaireDeleteToken = indexHtml.match(new RegExp(`action="/questionnaires/${questionnaire.questionnaire_id}/delete"[\\s\\S]*?name="csrf_token" value="([a-f0-9]{64})"`))?.[1];
  const deletedQuestionnaire = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/delete`, form({ csrf_token: questionnaireDeleteToken }));
  assert.equal(deletedQuestionnaire.status, 303);
  assert.equal(deletedQuestionnaire.headers.get("location"), "/questionnaires");
  assert.throws(() => store.get(questionnaire.questionnaire_id), /Questionnaire not found/);
});

test("renders nested response answers with their hierarchy and condition", async () => {
  const questionnaire = store.create({ authentication_type: "self_report",
    title: "Nested review",
    questions: [{
      id: "decision",
      type: "single_choice",
      title: "Decision",
      options: [{ value: "keep", label: "Keep" }, { value: "change", label: "Change" }],
      children: [{ id: "detail", type: "long_text", title: "Change detail", show_when: ["change"] }],
    }],
  });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { decision: "change", detail: "Use the attached workflow" }, { name: "Ada Lovelace", email: "ada@example.com" });

  const detail = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.response_id}`, { headers: trustedHeaders });
  const html = await detail.text();
  assert.equal(detail.status, 200);
  assert.match(html, /class="answer depth-1"/);
  assert.match(html, /class="answer depth-2"/);
  assert.match(html, /<h2>Decision<\/h2>/);
  assert.match(html, /<div class="answer-children" role="group" aria-label="Follow-up answers"><section class="answer depth-2"><h3>Change detail<\/h3>/);
  assert.match(html, /Follow-up when parent answer is: Change/);
  assert.match(html, /Use the attached workflow/);
});

function subresourceUrl(signedUrl, suffix, extra = {}) {
  const source = new URL(signedUrl.replace(publicBaseUrl, baseUrl));
  const target = new URL(`${source.pathname}${suffix}`, baseUrl);
  target.search = source.search;
  for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
  return target.toString();
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

async function browserDraft(questionnaire) {
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, questionnaire.revision);
  const created = await json(await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(created.status, 201);
  const { response_id: responseId, edit_token: editToken } = created.body;
  const headers = { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": editToken };
  return {
    responseId,
    editToken,
    url: (suffix = "", extra) => subresourceUrl(signed.url, `/responses/${responseId}${suffix}`, extra),
    submit: async (answers) => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}/submit`), { method: "POST", headers, body: JSON.stringify({ answers }) })),
  };
}

async function upload(draft, target, bytes, { contentType, filename }) {
  const grant = await json(await fetch(draft.url("/attachments/capability"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": draft.editToken },
    body: JSON.stringify(target),
  }));
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  const query = { ...target, filename, upload_expires: String(grant.body.upload_expires), upload_signature: grant.body.upload_signature };
  const result = await json(await fetch(draft.url("/attachments", query), {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Questionnaire-Edit-Token": draft.editToken },
    body: bytes,
  }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

test("renders uploaded images and repeatable rows, and serves attachments only behind the trusted header", async () => {
  const questionnaire = store.create({
    title: "Inventory",
    questions: [
      { id: "receipt", type: "file_upload", title: "Receipt photo", required: true },
      {
        id: "rooms",
        type: "repeatable_rows",
        title: "Rooms",
        required: true,
        fields: [
          { id: "name", type: "short_text", title: "Room <name>", required: true },
          { id: "kind", type: "single_choice", title: "Kind", options: [{ value: "bed", label: "Bedroom" }, { value: "bath", label: "Bathroom" }] },
          { id: "photo", type: "file_upload", title: "Photo", settings: { formats: ["png"], max_files: 2 } },
        ],
      },
    ],
  });
  const id = questionnaire.questionnaire_id;
  const draft = await browserDraft(questionnaire);
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 90 } } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const receipt = await upload(draft, { question_id: "receipt" }, jpeg, { contentType: "image/jpeg", filename: "receipt <1>.jpg" });
  const photo = await upload(draft, { question_id: "rooms", row_id: "r2", field_id: "photo" }, png, { contentType: "image/png", filename: "den.png" });
  const submitted = await draft.submit({
    receipt: [receipt.attachment_id],
    rooms: [
      { row_id: "r1", values: { name: "<b>Kitchen</b>", kind: "bath" } },
      { row_id: "r2", values: { name: "Den", kind: "bed", photo: [photo.attachment_id] } },
    ],
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const other = await browserDraft(questionnaire);

  const detail = await fetch(`${baseUrl}/questionnaires/${id}/responses/${draft.responseId}`, { headers: trustedHeaders });
  assert.equal(detail.status, 200);
  const html = await detail.text();
  const receiptUrl = `/questionnaires/${id}/responses/${draft.responseId}/attachments/${receipt.attachment_id}`;
  const photoUrl = `/questionnaires/${id}/responses/${draft.responseId}/attachments/${photo.attachment_id}`;
  assert.match(html, new RegExp(`<a href="${receiptUrl}"[^>]*><img src="${receiptUrl}"`));
  assert.match(html, new RegExp(`<img src="${photoUrl}"`));
  assert.match(html, /receipt &lt;1&gt;\.jpg/);
  assert.match(html, /64 × 48 px/);
  assert.match(html, /30 × 20 px/);
  const size = (bytes) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  assert.match(html, new RegExp(`64 × 48 px · ${size(receipt.bytes)}`));
  assert.match(html, new RegExp(`30 × 20 px · ${size(photo.bytes)}`));
  assert.match(html, /Row 1[\s\S]*&lt;b&gt;Kitchen&lt;\/b&gt;[\s\S]*Bathroom[\s\S]*Row 2[\s\S]*Den[\s\S]*Bedroom[\s\S]*den\.png/);
  assert.match(html, /Room &lt;name&gt;/);
  assert.doesNotMatch(html, /<b>Kitchen/);
  assert.doesNotMatch(html, /<name>/);

  const image = await fetch(`${baseUrl}${receiptUrl}`, { headers: trustedHeaders });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("content-security-policy"), /sandbox/);
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 64);

  assert.equal((await fetch(`${baseUrl}${receiptUrl}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/questionnaires/${id}/responses/${other.responseId}/attachments/${receipt.attachment_id}`, { headers: trustedHeaders })).status, 404);
  assert.equal((await fetch(`${baseUrl}/questionnaires/${id}/responses/${draft.responseId}/attachments/${"A".repeat(24)}`, { headers: trustedHeaders })).status, 404);
  assert.equal((await fetch(`${baseUrl}/questionnaires/${id}/responses/${draft.responseId}/attachments/not-an-id`, { headers: trustedHeaders })).status, 404);
});

function cardFor(html, id) {
  return html.match(new RegExp(`<article class="card"[^>]*>(?:(?!</article>)[\\s\\S])*?data-sign-questionnaire="${id}"[\\s\\S]*?</article>`))?.[0] ?? "";
}

function addResponses(id, revision, submitted, drafts) {
  const respondent = undefined;
  for (let index = 0; index < submitted; index += 1) {
    const created = store.createResponse(id, revision);
    store.submitResponse(id, revision, created.response_id, created.edit_token, { q: `s${index}` }, respondent);
  }
  for (let index = 0; index < drafts; index += 1) {
    const created = store.createResponse(id, revision);
    store.saveResponse(id, revision, created.response_id, created.edit_token, { q: `d${index}` });
  }
}

function setTimes(responseId, { submitted, updated }) {
  store.db.prepare("UPDATE responses SET submitted_at = COALESCE(?, submitted_at), updated_at = COALESCE(?, updated_at) WHERE id = ?").run(submitted ?? null, updated ?? null, responseId);
}

function makeResponse(id, revision, kind, label, { respondent, times = {} } = {}) {
  const created = store.createResponse(id, revision);
  if (kind === "submitted") store.submitResponse(id, revision, created.response_id, created.edit_token, { q: label }, respondent);
  else store.saveResponse(id, revision, created.response_id, created.edit_token, { q: label });
  setTimes(created.response_id, times);
  return created.response_id;
}

const questionsOf = (name) => [{ id: "q", type: "short_text", title: name }];
const previewOf = (card) => card.match(/<ul class="recent-responses"[\s\S]*?<\/ul>/)?.[0] ?? "";
const linksOf = (card) => [...card.matchAll(/<a class="recent-link" href="([^"]+)"/g)].map((match) => match[1]);

test("card preview replaces the count table with at most five recent responses, submissions first", async () => {
  const mixed = store.create({ title: "Mixed", questions: questionsOf("one") }).questionnaire_id;
  const day = (n) => `2026-03-0${n}T10:00:00.000Z`;
  const ids = {};
  ids.s1 = makeResponse(mixed, 1, "submitted", "a", { times: { submitted: day(1) } });
  store.update(mixed, { questions: questionsOf("two") });
  ids.s2 = makeResponse(mixed, 2, "submitted", "b", { times: { submitted: day(5) } });
  ids.s3 = makeResponse(mixed, 2, "submitted", "c", { times: { submitted: day(3) } });
  store.update(mixed, { questions: questionsOf("three") });
  ids.s4 = makeResponse(mixed, 3, "submitted", "d", { times: { submitted: day(4) } });
  ids.s5 = makeResponse(mixed, 3, "submitted", "e", { times: { submitted: day(2) } });
  ids.s6 = makeResponse(mixed, 3, "submitted", "f", { times: { submitted: day(6) } });
  // Newer draft must not displace any submission.
  ids.d1 = makeResponse(mixed, 3, "draft", "g", { times: { updated: "2026-04-01T00:00:00.000Z" } });
  // Creation order differs from submission order: s1 was created first but submitted earliest.

  const html = await (await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders })).text();
  const card = cardFor(html, mixed);
  assert.doesNotMatch(card, /responses-table|<table|<tr|All revisions|Previous revisions/);
  const links = linksOf(card);
  assert.deepEqual(links, [ids.s6, ids.s2, ids.s4, ids.s3, ids.s5].map((r) => `/questionnaires/${mixed}/responses/${r}`));
  assert.doesNotMatch(card, new RegExp(ids.d1));
  assert.doesNotMatch(card, new RegExp(ids.s1));
  assert.match(card, /Revision 3/);
  assert.match(card, /Revision 2/);
  assert.match(card, new RegExp(`href="/questionnaires/${mixed}/responses">Responses<`));
  assert.match(card, /Revision 3 · 1 question</);
  assert.ok(store.list({ status: "all" }).questionnaires.every((item) => !("recent_responses" in item)), "store.list contract has no preview field");
  assert.deepEqual(store.get(mixed).response_counts, { total: 4, drafts: 1, submitted: 3 });
  assert.deepEqual(store.get(mixed, 2).response_counts, { total: 2, drafts: 0, submitted: 2 });
  // Detail link shows the historical revision's answers.
  const detail = await (await fetch(`${baseUrl}${links[1]}`, { headers: trustedHeaders })).text();
  assert.match(detail, /Revision 2/);
  assert.match(detail, /two/);
});

test("card preview fills leftover places with drafts by update time, with ID tie break", async () => {
  const id = store.create({ title: "Fill", questions: questionsOf("one") }).questionnaire_id;
  const tie = "2026-05-01T00:00:00.000Z";
  const s1 = makeResponse(id, 1, "submitted", "a", { times: { submitted: "2026-05-02T00:00:00.000Z" } });
  const s2 = makeResponse(id, 1, "submitted", "b", { times: { submitted: "2026-05-03T00:00:00.000Z" } });
  const d1 = makeResponse(id, 1, "draft", "c", { times: { updated: tie } });
  const d2 = makeResponse(id, 1, "draft", "d", { times: { updated: tie } });
  const d3 = makeResponse(id, 1, "draft", "e", { times: { updated: "2026-05-09T00:00:00.000Z" } });
  const d4 = makeResponse(id, 1, "draft", "f", { times: { updated: "2026-04-01T00:00:00.000Z" } });
  const [tieFirst, tieSecond] = [d1, d2].sort();
  const html = await (await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders })).text();
  const links = linksOf(cardFor(html, id));
  assert.deepEqual(links, [s2, s1, d3, tieFirst, tieSecond].map((r) => `/questionnaires/${id}/responses/${r}`));
  assert.ok(!links.some((link) => link.endsWith(d4)));
  const again = linksOf(cardFor(await (await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders })).text(), id));
  assert.deepEqual(again, links, "order is stable across requests");
});

test("card preview handles drafts only, no responses, names, anonymity, escaping and isolation", async () => {
  const draftsOnly = store.create({ title: "Drafts", questions: questionsOf("a") }).questionnaire_id;
  for (let index = 0; index < 7; index += 1) makeResponse(draftsOnly, 1, "draft", `d${index}`, { times: { updated: `2026-06-0${index + 1}T00:00:00.000Z` } });
  const none = store.create({ title: "None", questions: questionsOf("b") }).questionnaire_id;
  store.update(none, { questions: questionsOf("c") });
  const named = store.create({ title: "Named", questions: questionsOf("d"), authentication_type: "self_report" }).questionnaire_id;
  const other = store.create({ title: "Other", questions: questionsOf("e") }).questionnaire_id;
  makeResponse(other, 1, "submitted", "x", { times: { submitted: "2026-07-09T00:00:00.000Z" } });
  const personId = makeResponse(named, 1, "submitted", "p", { respondent: { name: "Ada <b>Lovelace</b>", email: "ada@example.test" }, times: { submitted: "2026-07-01T00:00:00.000Z" } });
  makeResponse(named, 1, "draft", "q", { times: { updated: "2026-07-02T00:00:00.000Z" } });

  const html = await (await fetch(`${baseUrl}/questionnaires`, { headers: trustedHeaders })).text();
  const draftCard = cardFor(html, draftsOnly);
  assert.equal(linksOf(draftCard).length, 5);
  assert.equal([...draftCard.matchAll(/>Draft</g)].length >= 5, true);
  assert.doesNotMatch(draftCard, /Submitted/);
  assert.match(draftCard, /2026-06-07T00:00:00\.000Z/);
  assert.doesNotMatch(draftCard, /2026-06-02T00:00:00\.000Z/);

  const noneCard = cardFor(html, none);
  assert.equal(linksOf(noneCard).length, 0);
  assert.match(noneCard, /No responses yet/);
  assert.doesNotMatch(noneCard, /<table|recent-link/);

  const namedCard = cardFor(html, named);
  assert.match(namedCard, /Ada &lt;b&gt;Lovelace&lt;\/b&gt;/);
  assert.doesNotMatch(namedCard, /<b>Lovelace|ada@example\.test|edit_token|answers/);
  assert.deepEqual(linksOf(namedCard)[0], `/questionnaires/${named}/responses/${personId}`);
  assert.equal(linksOf(namedCard).length, 2);
  assert.doesNotMatch(namedCard, new RegExp(`/questionnaires/${other}/`));
  assert.equal(linksOf(cardFor(html, other)).length, 1);
});

test("dashboard defaults to open questionnaires and paginates, searches and filters on the server", async () => {
  const get = async (query = "") => (await fetch(`${baseUrl}/questionnaires${query}`, { headers: trustedHeaders })).text();
  const make = (title, description = "") => store.create({ title, description, questions: [{ id: "q", type: "short_text", title: "Q" }] }).questionnaire_id;
  const ids = [];
  for (let index = 1; index <= 14; index += 1) ids.push(make(`Survey ${String(index).padStart(2, "0")}`, index === 3 ? "Quarterly 100% review_final" : ""));
  const closedId = make("Archive Closed", "Legacy");
  store.setStatus(closedId, "closed");
  const titles = (html) => [...html.matchAll(/<h2><a [^>]*>([^<]*)<\/a><\/h2>/g)].map((match) => match[1]);

  const first = await get();
  assert.equal(titles(first).length, 12);
  assert.ok(!titles(first).includes("Archive Closed"));
  assert.match(first, /Showing 1\u201312 of 14/);
  assert.match(first, /Page 1 of 2/);
  assert.match(first, /<option value="open" selected>/);
  assert.match(first, /href="\/questionnaires\?offset=12"/);
  assert.doesNotMatch(first, /Previous<\/a>/);

  const second = await get("?offset=12");
  assert.equal(titles(second).length, 2);
  assert.match(second, /Showing 13\u201314 of 14/);
  assert.match(second, /href="\/questionnaires"[^>]*>Previous|rel="prev" href="\/questionnaires"/);
  assert.equal(titles(await get("?offset=999")).length, 2, "excessive offsets clamp to the last page");

  assert.deepEqual(titles(await get("?status=closed")), ["Archive Closed"]);
  assert.equal(titles(await get("?status=all")).length, 12);
  assert.match(await get("?status=all"), /Showing 1\u201312 of 15/);
  assert.equal(titles(await get("?status=bogus")).length, 12, "unknown status falls back to open");

  assert.deepEqual(titles(await get("?q=survey%2007")), ["Survey 07"]);
  assert.deepEqual(titles(await get("?q=QUARTERLY")), ["Survey 03"], "matches description, case-insensitively");
  assert.deepEqual(titles(await get(`?q=${ids[4]}`)), ["Survey 05"], "matches the ID");
  assert.deepEqual(titles(await get("?q=100%25")), ["Survey 03"], "percent is literal");
  assert.deepEqual(titles(await get("?q=review_f")), ["Survey 03"]);
  assert.deepEqual(titles(await get("?q=review%5Ff")), ["Survey 03"]);
  assert.deepEqual(titles(await get("?q=%25")), ["Survey 03"], "bare wildcard does not match everything");
  assert.deepEqual(titles(await get("?q=_")), ["Survey 03"], "underscore is literal");
  assert.deepEqual(titles(await get("?q=archive")), [], "open filter hides closed matches");
  assert.deepEqual(titles(await get("?q=archive&status=all")), ["Archive Closed"]);
  assert.deepEqual(titles(await get("?q=archive&status=closed")), ["Archive Closed"]);
  assert.deepEqual(titles(await get("?q=legacy&status=open")), []);

  const filteredPage = await get("?q=survey&status=all");
  assert.match(filteredPage, /Showing 1\u201312 of 14/);
  assert.match(filteredPage, /href="\/questionnaires\?q=survey&amp;status=all&amp;offset=12"/);
  const filteredSecond = await get("?q=survey&status=all&offset=12");
  assert.match(filteredSecond, /rel="prev" href="\/questionnaires\?q=survey&amp;status=all"/);
  assert.match(filteredSecond, /value="survey"/);

  const none = await get("?q=zzzz");
  assert.match(none, /No matching questionnaires/);
  assert.match(none, /Showing 0 of 0/);
  assert.match(none, /href="\/questionnaires">Reset filters/);
  assert.match(none, /href="\/questionnaires">Clear/);
  const noneFar = await get("?q=zzzz&offset=999");
  assert.match(noneFar, /Page 1 of 1|Showing 0 of 0/);
  assert.doesNotMatch(noneFar, /Previous<\/a>|Next<\/a>|Page \d+ of/, "no pagination for an empty result");
});

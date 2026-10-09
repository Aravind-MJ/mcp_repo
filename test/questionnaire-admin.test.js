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
  assert.match(html, /<strong>1<\/strong><span>draft<\/span>/);
  assert.match(html, /<strong>0<\/strong><span>submitted<\/span>/);
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

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";

let root;
let server;
let baseUrl;
let config;
let store;
let mailer;
let now;
const sharedSecret = "s".repeat(64);
const questions = [
  { id: "contact", type: "email", title: "Contact email" },
  { id: "note", type: "short_text", title: "Note", required: true },
];
const ada = { name: "Ada Lovelace", email: "ada@example.com" };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-auth-flow-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, sharedSecret, { mode: 0o600 });
  now = Date.parse("2026-10-08T10:00:00Z");
  mailer = { configured: true, sent: [], async sendVerificationCode(message) { this.sent.push(message); } };
  config = {
    host: "127.0.0.1", port: 0, dataDir: path.join(root, "data"), secretFile,
    publicBaseUrl: "https://mcp.example.test", maxHtmlBytes: 1024, maxListItems: 200,
    maxQuestionnaires: 500, maxQuestions: 200, maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
    questionnaireMailer: mailer,
    clock: () => now,
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

function subresourceUrl(signedUrl, suffix, extra = {}) {
  const source = new URL(signedUrl.replace(config.publicBaseUrl, baseUrl));
  const target = new URL(`${source.pathname}${suffix}`, baseUrl);
  target.search = source.search;
  for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
  return target.toString();
}

async function browserDraft(questionnaire) {
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, questionnaire.revision);
  const draft = await (await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  const headers = { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token };
  const url = (suffix) => subresourceUrl(signed.url, `/responses/${draft.response_id}${suffix}`);
  return { signed, draft, headers, url };
}

async function mcpClient(headers = {}, url = baseUrl) {
  const client = new Client({ name: "questionnaire-auth-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}`, ...headers } },
  }));
  return client;
}

async function requestMcpCodes(client, questionnaireId, count, prefix) {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    results.push(await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: questionnaireId, respondent: { name: "P", email: `${prefix}${index}@example.com` } } }));
  }
  return results;
}

test("questionnaire page exposes the mode and a submit-only identity dialog with OTP guidance", async () => {
  for (const mode of ["anonymous", "self_report", "email_verified"]) {
    const questionnaire = store.create({ title: `Mode ${mode}`, authentication_type: mode, questions });
    const signed = await store.createSignedUrl(questionnaire.questionnaire_id);
    const html = await (await fetch(signed.url.replace(config.publicBaseUrl, baseUrl))).text();
    assert.match(html, new RegExp(`"authentication_type":"${mode}"`));
    assert.doesNotMatch(html, /<div class="respondent-fields"/, "identity is not always visible");
    if (mode === "anonymous") {
      assert.doesNotMatch(html, /<dialog id="identity-dialog"/);
      continue;
    }
    assert.match(html, /<dialog id="identity-dialog"/);
    assert.match(html, /name="respondent_name"/);
    assert.match(html, /name="respondent_email"/);
    if (mode === "email_verified") {
      assert.match(html, /spam or junk/i);
      assert.match(html, /10 minutes/);
      assert.match(html, /name="verification_code"/);
      assert.match(html, /Change email/);
      assert.match(html, /can take a few minutes/i);
      assert.match(html, /We queued a verification email to/);
      assert.match(html, /We queued a new verification email/);
      assert.doesNotMatch(html, /We sent a|code was sent\./);
    } else {
      assert.doesNotMatch(html, /name="verification_code"/);
    }
  }
});

test("browser email_verified flow requires response-scoped OTP and rejects misuse", async () => {
  const questionnaire = store.create({ title: "Verified", authentication_type: "email_verified", questions });
  const { draft, headers, url } = await browserDraft(questionnaire);

  const noProof = await fetch(url("/submit"), { method: "POST", headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada }) });
  assert.equal(noProof.status, 403);
  assert.match((await noProof.json()).error, /verif/i);

  const badToken = await fetch(url("/verification"), { method: "POST", headers: { ...headers, "x-questionnaire-edit-token": "0".repeat(64) }, body: JSON.stringify({ respondent: ada }) });
  assert.equal(badToken.status, 404);
  const badScope = await fetch(subresourceUrl((await store.createSignedUrl(questionnaire.questionnaire_id)).url, `/responses/${draft.response_id}/verification`, { response_signature: "x".repeat(43), response_revision: "1" }), { method: "POST", headers, body: JSON.stringify({ respondent: ada }) });
  assert.equal(badScope.status, 404);
  const crossSite = await fetch(url("/verification"), { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: JSON.stringify({ respondent: ada }) });
  assert.equal(crossSite.status, 403);
  assert.equal(mailer.sent.length, 0);

  const sent = await fetch(url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent: ada }) });
  assert.equal(sent.status, 202);
  const sentBody = await sent.json();
  assert.equal(sentBody.email, ada.email);
  assert.equal(sentBody.delivery, "accepted");
  assert.equal("code" in sentBody, false);
  assert.ok(sentBody.expires_at && sentBody.resend_available_at);

  const tooSoon = await fetch(url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent: ada }) });
  assert.equal(tooSoon.status, 429);

  const wrong = await fetch(url("/verification/confirm"), { method: "POST", headers, body: JSON.stringify({ email: ada.email, code: mailer.sent[0].code === "000000" ? "111111" : "000000" }) });
  assert.equal(wrong.status, 400);
  const confirmed = await fetch(url("/verification/confirm"), { method: "POST", headers, body: JSON.stringify({ email: ada.email, code: mailer.sent[0].code }) });
  assert.equal(confirmed.status, 200);
  const { verification_proof: proof } = await confirmed.json();

  const other = await browserDraft(questionnaire);
  const moved = await fetch(other.url("/submit"), { method: "POST", headers: other.headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada, verification_proof: proof }) });
  assert.equal(moved.status, 403);

  const submitted = await fetch(url("/submit"), { method: "POST", headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada, verification_proof: proof }) });
  assert.equal(submitted.status, 200);
  const body = await submitted.json();
  assert.equal(body.identity_status, "email_verified");
  assert.ok(body.email_verified_at);
  const replay = await fetch(url("/submit"), { method: "POST", headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada, verification_proof: proof }) });
  assert.equal(replay.status, 409);
});

test("browser anonymous and self_report submissions follow their mode", async () => {
  const anon = store.create({ title: "Anon", questions });
  const a = await browserDraft(anon);
  assert.equal((await fetch(a.url("/submit"), { method: "POST", headers: a.headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada }) })).status, 400);
  assert.equal((await fetch(a.url("/verification"), { method: "POST", headers: a.headers, body: JSON.stringify({ respondent: ada }) })).status, 400);
  const anonOk = await fetch(a.url("/submit"), { method: "POST", headers: a.headers, body: JSON.stringify({ answers: { note: "x", contact: "c@example.com" } }) });
  assert.equal(anonOk.status, 200);
  assert.equal((await anonOk.json()).respondent, null);

  const self = store.create({ title: "Self", authentication_type: "self_report", questions });
  const s = await browserDraft(self);
  assert.equal((await fetch(s.url("/submit"), { method: "POST", headers: s.headers, body: JSON.stringify({ answers: { note: "x" } }) })).status, 400);
  const selfOk = await fetch(s.url("/submit"), { method: "POST", headers: s.headers, body: JSON.stringify({ answers: { note: "x" }, respondent: ada }) });
  assert.equal(selfOk.status, 200);
  assert.equal((await selfOk.json()).identity_status, "self_reported");
});

test("verification sends are throttled per source IP across browser requests", async () => {
  const questionnaire = store.create({ title: "Throttle", authentication_type: "email_verified", questions });
  for (let index = 0; index < 20; index += 1) {
    const { headers, url } = await browserDraft(questionnaire);
    const response = await fetch(url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent: { name: "P", email: `p${index}@example.com` } }) });
    assert.equal(response.status, 202);
  }
  const { headers, url } = await browserDraft(questionnaire);
  const limited = await fetch(url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent: { name: "P", email: "late@example.com" } }) });
  assert.equal(limited.status, 429);
});

test("MCP exposes mode schema and enforces the same email verification without bearer bypass", async () => {
  const client = await mcpClient();
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("request_questionnaire_email_verification"));
    assert.ok(names.includes("verify_questionnaire_email"));
    assert.match(JSON.stringify(tools.tools.find((tool) => tool.name === "create_questionnaire").inputSchema), /email_verified/);

    const created = (await client.callTool({ name: "create_questionnaire", arguments: { title: "MCP verified", authentication_type: "email_verified", questions } })).structuredContent;
    assert.equal(created.authentication_type, "email_verified");
    const defaulted = (await client.callTool({ name: "create_questionnaire", arguments: { title: "MCP default", questions } })).structuredContent;
    assert.equal(defaulted.authentication_type, "anonymous");

    const direct = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, respondent: ada, answers: { note: "x" } } });
    assert.equal(direct.isError, true);
    assert.match(direct.content[0].text, /verif/i);

    const started = (await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: created.questionnaire_id, respondent: ada } })).structuredContent;
    assert.match(started.response_id, /^[A-Za-z0-9]{24}$/);
    assert.equal("code" in started, false);
    const code = mailer.sent.at(-1).code;

    const wrong = await client.callTool({ name: "verify_questionnaire_email", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, email: ada.email, code: code === "000000" ? "111111" : "000000" } });
    assert.equal(wrong.isError, true);
    const verified = (await client.callTool({ name: "verify_questionnaire_email", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, email: ada.email, code } })).structuredContent;
    assert.match(verified.verification_proof, /^[a-f0-9]{64}$/);

    const wrongEmail = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, verification_proof: verified.verification_proof, respondent: { name: "Eve", email: "eve@example.com" }, answers: { note: "x" } } });
    assert.equal(wrongEmail.isError, true);
    const submitted = (await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, verification_proof: verified.verification_proof, respondent: ada, answers: { note: "x" } } })).structuredContent;
    assert.equal(submitted.identity_status, "email_verified");
    assert.equal(submitted.authentication_type, "email_verified");
    const replay = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, verification_proof: verified.verification_proof, respondent: ada, answers: { note: "x" } } });
    assert.equal(replay.isError, true);

    const anonymous = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: defaulted.questionnaire_id, respondent: ada, answers: { note: "x" } } });
    assert.equal(anonymous.isError, true);
    const anonOk = (await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: defaulted.questionnaire_id, answers: { note: "x" } } })).structuredContent;
    assert.equal(anonOk.identity_status, "anonymous");
  } finally {
    await client.close();
  }
});

test("admin response views show the trust level", async () => {
  const questionnaire = store.create({ title: "Trust", authentication_type: "self_report", questions });
  const submitted = store.submitNewResponse(questionnaire.questionnaire_id, undefined, ada, { note: "x" });
  const { renderTrustLabel } = await import("../src/questionnaire/admin.js");
  assert.equal(renderTrustLabel(submitted), "Self-reported identity");
  assert.equal(renderTrustLabel({ identity_status: "email_verified", email_verified_at: "2026-10-08T10:00:00.000Z" }), "Email verified");
  assert.equal(renderTrustLabel({ identity_status: "legacy_missing" }), "Identity not collected (legacy)");
  assert.equal(renderTrustLabel({ identity_status: "anonymous" }), "Anonymous");
});

test("MCP verification limits use each caller's forwarded source address", async () => {
  const questionnaire = store.create({ title: "MCP per IP", authentication_type: "email_verified", questions });
  const first = await mcpClient({ "X-Forwarded-For": "198.51.100.1" });
  const second = await mcpClient({ "X-Forwarded-For": "198.51.100.2" });
  try {
    const accepted = await requestMcpCodes(first, questionnaire.questionnaire_id, 20, "a");
    assert.ok(accepted.every((result) => !result.isError));
    const limited = await first.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: questionnaire.questionnaire_id, respondent: { name: "P", email: "late@example.com" } } });
    assert.equal(limited.isError, true);
    assert.match(limited.content[0].text, /network in the last hour/);
    const other = await second.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: questionnaire.questionnaire_id, respondent: { name: "P", email: "other@example.com" } } });
    assert.equal(other.isError, undefined);
  } finally {
    await first.close();
    await second.close();
  }
});

test("with proxy trust disabled, forged X-Forwarded-For values cannot escape the per-IP limit", async () => {
  const created = await createApp({ ...config, dataDir: path.join(root, "untrusted-data"), trustProxy: false });
  const untrusted = createServer(created.app);
  await new Promise((resolve) => untrusted.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${untrusted.address().port}`;
  const questionnaire = created.questionnaireStore.create({ title: "Untrusted proxy", authentication_type: "email_verified", questions });
  try {
    for (let index = 0; index < 21; index += 1) {
      const client = await mcpClient({ "X-Forwarded-For": `203.0.113.${index}` }, url);
      try {
        const result = await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: questionnaire.questionnaire_id, respondent: { name: "P", email: `f${index}@example.com` } } });
        assert.equal(Boolean(result.isError), index === 20, `request ${index}`);
      } finally {
        await client.close();
      }
    }
  } finally {
    await new Promise((resolve) => untrusted.close(resolve));
    created.questionnaireStore.close();
  }
});

test("MCP verified submit rejects an explicit revision that differs from the pending response", async () => {
  const client = await mcpClient();
  try {
    const created = (await client.callTool({ name: "create_questionnaire", arguments: { title: "Revisioned", authentication_type: "email_verified", questions } })).structuredContent;
    const started = (await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: created.questionnaire_id, revision: 1, respondent: ada } })).structuredContent;
    await client.callTool({ name: "update_questionnaire", arguments: { questionnaire_id: created.questionnaire_id, title: "Revisioned v2" } });
    const proof = (await client.callTool({ name: "verify_questionnaire_email", arguments: { questionnaire_id: created.questionnaire_id, response_id: started.response_id, email: ada.email, code: mailer.sent.at(-1).code } })).structuredContent.verification_proof;
    const submit = (revision) => client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, revision, response_id: started.response_id, verification_proof: proof, respondent: ada, answers: { note: "x" } } });
    const mismatched = await submit(2);
    assert.equal(mismatched.isError, true);
    assert.match(mismatched.content[0].text, /revision 1, not revision 2/);
    const accepted = (await submit(1)).structuredContent;
    assert.equal(accepted.revision, 1);
    assert.equal(accepted.identity_status, "email_verified");
  } finally {
    await client.close();
  }
});

test("confirming a code is refused once the questionnaire is closed, in the browser and MCP", async () => {
  const questionnaire = store.create({ title: "Closing", authentication_type: "email_verified", questions });
  const { headers, url } = await browserDraft(questionnaire);
  assert.equal((await fetch(url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent: ada }) })).status, 202);
  const browserCode = mailer.sent.at(-1).code;
  const client = await mcpClient();
  try {
    const started = (await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: questionnaire.questionnaire_id, respondent: { name: "B", email: "b@example.com" } } })).structuredContent;
    const mcpCode = mailer.sent.at(-1).code;
    store.setStatus(questionnaire.questionnaire_id, "closed");
    const browserConfirm = await fetch(url("/verification/confirm"), { method: "POST", headers, body: JSON.stringify({ email: ada.email, code: browserCode }) });
    assert.equal(browserConfirm.status, 409);
    assert.match((await browserConfirm.json()).error, /closed/);
    const mcpConfirm = await client.callTool({ name: "verify_questionnaire_email", arguments: { questionnaire_id: questionnaire.questionnaire_id, response_id: started.response_id, email: "b@example.com", code: mcpCode } });
    assert.equal(mcpConfirm.isError, true);
    assert.match(mcpConfirm.content[0].text, /closed/);
  } finally {
    await client.close();
  }
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { Worker } from "node:worker_threads";
import addressparser from "nodemailer/lib/addressparser";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { QuestionnaireStore, RESPONDENT_EMAIL_PATTERN, normalizeRespondent } from "../src/questionnaire/store.js";

let root;
let store;
let now;
let mailer;
const questions = [{ id: "note", type: "short_text", title: "Note", required: true }];
const ada = { name: "Ada Lovelace", email: "ada@example.com" };

// Each string is something an SMTP library may parse as a group, comment, display name, or several recipients.
const HOSTILE_EMAILS = [
  "alias0:ada@example.com;",
  "alias5:ada@example.com;",
  "Ada <ada@example.com>",
  "<ada@example.com>",
  "ada@example.com (comment)",
  "(comment)ada@example.com",
  "ada@example.com, eve@example.com",
  "ada@example.com;eve@example.com",
  "\"ada\"@example.com",
  "ada@example.com\r\nBcc: eve@example.com",
  "ada@example.com\u0000",
  "ada@[127.0.0.1]",
  "ada..lovelace@example.com",
  ".ada@example.com",
  "ada@-example.com",
  "ada@example",
  "a\\da@example.com",
];
const ACCEPTED_EMAILS = ["ada@example.com", "ada.lovelace+forms@mail.example.co.uk", "o'brien@example.ie", "x_y-z@sub-domain.example.org"];

function fakeMailer() {
  return { configured: true, sent: [], async sendVerificationCode(message) { this.sent.push(message); } };
}

function databasePath() {
  return path.join(root, "data", "questionnaire", "questionnaires.sqlite3");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-auth-security-test-"));
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(path.join(root, "secrets", "shared-secret"), "s".repeat(64), { mode: 0o600 });
  now = Date.parse("2026-10-08T10:00:00Z");
  mailer = fakeMailer();
  store = new QuestionnaireStore({
    dataDir: path.join(root, "data"), publicBaseUrl: "https://mcp.example.test", secretFile: path.join(root, "secrets", "shared-secret"),
    maxQuestionnaires: 500, maxQuestions: 200, maxAnswerBytes: 256 * 1024, clock: () => now, questionnaireMailer: mailer,
  });
  await store.initialize();
});

afterEach(async () => {
  store?.close();
  await rm(root, { recursive: true, force: true });
});

function request(questionnaire, draft, respondent = ada, sourceIp = "203.0.113.7") {
  return store.requestEmailVerification({ questionnaireId: questionnaire.questionnaire_id, revision: 1, responseId: draft.response_id, editToken: draft.edit_token, respondent, sourceIp });
}

test("respondent email must be exactly one bare mailbox", () => {
  for (const email of HOSTILE_EMAILS) {
    assert.throws(() => normalizeRespondent({ name: "Ada", email }), /respondent email/i, JSON.stringify(email));
    assert.equal(RESPONDENT_EMAIL_PATTERN.test(email.trim()), false, `shared MCP pattern accepts ${JSON.stringify(email)}`);
  }
  for (const email of ACCEPTED_EMAILS) {
    const normalized = normalizeRespondent({ name: "Ada", email }).email;
    // Nodemailer must read the stored value as one plain recipient that equals it exactly.
    assert.deepEqual(addressparser(normalized), [{ address: normalized, name: "" }], email);
    assert.ok(RESPONDENT_EMAIL_PATTERN.test(email));
  }
});

test("group syntax cannot multiply the per-email quota or bind a proof to a different string", async () => {
  const questionnaire = store.create({ title: "Verified", authentication_type: "email_verified", questions });
  for (let index = 0; index < 6; index += 1) {
    const draft = store.createResponse(questionnaire.questionnaire_id, 1);
    await assert.rejects(request(questionnaire, draft, { name: "Ada", email: `alias${index}:ada@example.com;` }, `198.51.100.${index}`), /respondent email/i);
  }
  assert.equal(mailer.sent.length, 0);
  const selfReport = store.create({ title: "Self", authentication_type: "self_report", questions });
  const draft = store.createResponse(selfReport.questionnaire_id, 1);
  assert.throws(() => store.submitResponse(selfReport.questionnaire_id, 1, draft.response_id, draft.edit_token, { note: "x" }, { name: "Ada", email: "Ada <ada@example.com>" }), /respondent email/i);
  assert.throws(() => store.submitNewResponse(selfReport.questionnaire_id, undefined, { name: "Ada", email: "alias0:ada@example.com;" }, { note: "x" }), /respondent email/i);
});

test("the SMTP adapter refuses a recipient Nodemailer would not read as the same single mailbox", async () => {
  const { createSmtpMailer } = await import("../src/questionnaire/mailer.js");
  const smtp = createSmtpMailer({ host: "127.0.0.1", port: 9, from: "forms@example.com" });
  for (const to of ["alias0:ada@example.com;", "Ada <ada@example.com>", "ada@example.com, eve@example.com"]) {
    await assert.rejects(smtp.sendVerificationCode({ to, code: "123456", questionnaireTitle: "T", expiresInMinutes: 10 }), (error) => error.status === 400, to);
  }
});

test("MCP rejects group-syntax respondent emails before any delivery", async () => {
  const secretFile = path.join(root, "secrets", "shared-secret");
  const created = await createApp({
    host: "127.0.0.1", port: 0, dataDir: path.join(root, "mcp-data"), secretFile, publicBaseUrl: "https://mcp.example.test",
    maxHtmlBytes: 1024, maxListItems: 200, maxQuestionnaires: 500, maxQuestions: 200, maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"], questionnaireMailer: mailer,
  });
  const server = createServer(created.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "security-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${"s".repeat(64)}` } },
  }));
  try {
    const verified = created.questionnaireStore.create({ title: "V", authentication_type: "email_verified", questions });
    const selfReport = created.questionnaireStore.create({ title: "S", authentication_type: "self_report", questions });
    for (const email of ["alias0:ada@example.com;", "Ada <ada@example.com>"]) {
      const started = await client.callTool({ name: "request_questionnaire_email_verification", arguments: { questionnaire_id: verified.questionnaire_id, respondent: { name: "Ada", email } } });
      assert.equal(started.isError, true);
      const submitted = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: selfReport.questionnaire_id, respondent: { name: "Ada", email }, answers: { note: "x" } } });
      assert.equal(submitted.isError, true);
    }
    assert.equal(mailer.sent.length, 0);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    created.questionnaireStore.close();
  }
});

// Runs SQL on a second SQLite connection in a worker, holds the write lock until released, then commits.
function lockingWorker(file, statements) {
  const worker = new Worker(`
    const { workerData, parentPort } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(workerData.file);
    db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    for (const [sql, ...params] of workerData.statements) db.prepare(sql).run(...params);
    parentPort.postMessage("locked");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    db.exec("COMMIT");
    db.close();
    parentPort.postMessage("committed");
  `, { eval: true, workerData: { file, statements } });
  const locked = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  const done = new Promise((resolve) => worker.once("exit", resolve));
  return { locked, done };
}

test("a concurrent worker's reservation is counted: the per-email hourly limit stays at five", async () => {
  const questionnaire = store.create({ title: "Race", authentication_type: "email_verified", questions });
  for (let index = 0; index < 4; index += 1) await request(questionnaire, store.createResponse(questionnaire.questionnaire_id, 1), ada, `198.51.100.${index}`);
  const db = new DatabaseSync(databasePath());
  const template = db.prepare("SELECT questionnaire_id, email_hash, source_hash FROM questionnaire_email_sends LIMIT 1").get();
  db.close();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  const worker = lockingWorker(databasePath(), [[
    "INSERT INTO questionnaire_email_sends (questionnaire_id, email_hash, source_hash, sent_at) VALUES (?, ?, ?, ?)",
    template.questionnaire_id, template.email_hash, "other-worker", now,
  ]]);
  await worker.locked;
  await assert.rejects(request(questionnaire, draft, ada, "192.0.2.50"), (error) => error.status === 429);
  await worker.done;
  const check = new DatabaseSync(databasePath());
  const count = Number(check.prepare("SELECT count(*) AS n FROM questionnaire_email_sends WHERE email_hash = ?").get(template.email_hash).n);
  check.close();
  assert.equal(count, 5);
});

test("a concurrent worker's resend is seen by the cooldown check", async () => {
  const questionnaire = store.create({ title: "Cooldown race", authentication_type: "email_verified", questions });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await request(questionnaire, draft);
  now += 61_000;
  const worker = lockingWorker(databasePath(), [["UPDATE questionnaire_email_verifications SET last_sent_at = ? WHERE response_id = ?", now, draft.response_id]]);
  await worker.locked;
  await assert.rejects(request(questionnaire, draft), (error) => error.status === 429 && /wait/i.test(error.message));
  await worker.done;
  assert.equal(mailer.sent.length, 1);
});

test("a correct code is refused when a concurrent worker used up the last failed attempt", async () => {
  const questionnaire = store.create({ title: "Attempt race", authentication_type: "email_verified", questions });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await request(questionnaire, draft);
  const code = mailer.sent.at(-1).code;
  const confirm = (value) => store.confirmEmailVerification({ questionnaireId: questionnaire.questionnaire_id, revision: 1, responseId: draft.response_id, editToken: draft.edit_token, email: ada.email, code: value });
  const wrong = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 4; attempt += 1) assert.throws(() => confirm(wrong), /incorrect/);
  const worker = lockingWorker(databasePath(), [["UPDATE questionnaire_email_verifications SET failed_attempts = failed_attempts + 1 WHERE response_id = ?", draft.response_id]]);
  await worker.locked;
  assert.throws(() => confirm(code), (error) => error.status === 429);
  await worker.done;
});

test("two connections cannot both turn one code into a proof", async () => {
  const questionnaire = store.create({ title: "Single use race", authentication_type: "email_verified", questions });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await request(questionnaire, draft);
  const code = mailer.sent.at(-1).code;
  // The worker plays the winning connection: it consumes the code first and holds the lock.
  const worker = lockingWorker(databasePath(), [["UPDATE questionnaire_email_verifications SET code_hash = NULL, code_salt = NULL, proof_hash = ?, proof_expires_at = ?, verified_at = ? WHERE response_id = ?", "a".repeat(64), now + 60_000, now, draft.response_id]]);
  await worker.locked;
  assert.throws(() => store.confirmEmailVerification({ questionnaireId: questionnaire.questionnaire_id, revision: 1, responseId: draft.response_id, editToken: draft.edit_token, email: ada.email, code }), /no active/i);
  await worker.done;
});

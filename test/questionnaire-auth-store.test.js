import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { QuestionnaireStore } from "../src/questionnaire/store.js";

let root;
let store;
let now;
let mailer;

const questions = [
  { id: "contact", type: "email", title: "Contact email" },
  { id: "note", type: "short_text", title: "Note", required: true },
];
const ada = { name: "Ada Lovelace", email: "ada@example.com" };
const ip = "203.0.113.7";

function fakeMailer() {
  return {
    configured: true,
    sent: [],
    fail: false,
    async sendVerificationCode(message) {
      this.sent.push(message);
      if (this.fail) {
        const error = new Error("rejected");
        throw error;
      }
    },
    lastCode() { return this.sent.at(-1).code; },
  };
}

function makeStore(extra = {}) {
  return new QuestionnaireStore({
    dataDir: path.join(root, "data"),
    publicBaseUrl: "https://mcp.example.test",
    secretFile: path.join(root, "secrets", "shared-secret"),
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
    clock: () => now,
    questionnaireMailer: mailer,
    ...extra,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-auth-store-test-"));
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(path.join(root, "secrets", "shared-secret"), "s".repeat(64), { mode: 0o600 });
  now = Date.parse("2026-10-08T10:00:00Z");
  mailer = fakeMailer();
  store = makeStore();
  await store.initialize();
});

afterEach(async () => {
  store?.close();
  await rm(root, { recursive: true, force: true });
});

function verifiedForm() {
  return store.create({ title: "Verified", authentication_type: "email_verified", questions });
}

async function requestCode(questionnaire, draft, respondent = ada, sourceIp = ip) {
  return store.requestEmailVerification({
    questionnaireId: questionnaire.questionnaire_id,
    revision: questionnaire.revision,
    responseId: draft.response_id,
    editToken: draft.edit_token,
    respondent,
    sourceIp,
  });
}

function confirmCode(questionnaire, draft, code, email = ada.email) {
  return store.confirmEmailVerification({
    questionnaireId: questionnaire.questionnaire_id,
    revision: questionnaire.revision,
    responseId: draft.response_id,
    editToken: draft.edit_token,
    email,
    code,
  });
}

function submitDraft(questionnaire, draft, respondent, proof) {
  return store.submitResponse(questionnaire.questionnaire_id, questionnaire.revision, draft.response_id, draft.edit_token, { note: "hi" }, respondent, undefined, { verificationProof: proof });
}

test("new questionnaires default to anonymous and updates retain or change the mode per revision", () => {
  const created = store.create({ title: "Default", questions });
  assert.equal(created.authentication_type, "anonymous");
  const retained = store.update(created.questionnaire_id, { title: "Renamed" });
  assert.equal(retained.revision, 2);
  assert.equal(retained.authentication_type, "anonymous");
  const changed = store.update(created.questionnaire_id, { authentication_type: "email_verified" });
  assert.equal(changed.authentication_type, "email_verified");
  assert.equal(store.get(created.questionnaire_id, 1).authentication_type, "anonymous");
  assert.equal(store.get(created.questionnaire_id, 2).authentication_type, "anonymous");
  assert.throws(() => store.create({ title: "Bad", authentication_type: "oauth", questions }), /authentication_type/);
  assert.equal(store.create({ title: "Self", authentication_type: "self_report", questions }).authentication_type, "self_report");
});

test("migration marks every pre-existing revision self_report, preserves legacy null identity, and is idempotent", async () => {
  const questionnaire = store.create({ title: "Legacy", questions });
  store.update(questionnaire.questionnaire_id, { title: "Legacy v2" });
  const draft = store.createResponse(questionnaire.questionnaire_id, 2);
  const databasePath = path.join(root, "data", "questionnaire", "questionnaires.sqlite3");
  store.close();
  store = null;
  const legacy = new DatabaseSync(databasePath);
  legacy.exec("DROP TABLE IF EXISTS questionnaire_email_verifications; DROP TABLE IF EXISTS questionnaire_email_sends;");
  legacy.exec("ALTER TABLE questionnaire_revisions DROP COLUMN authentication_type;");
  legacy.exec("ALTER TABLE responses DROP COLUMN email_verified_at; ALTER TABLE responses DROP COLUMN channel;");
  legacy.prepare("UPDATE responses SET status = 'submitted', answers_json = '{\"note\":\"old\"}', submitted_at = updated_at WHERE id = ?").run(draft.response_id);
  legacy.close();

  for (let pass = 0; pass < 2; pass += 1) {
    store = makeStore();
    await store.initialize();
    assert.equal(store.get(questionnaire.questionnaire_id, 1).authentication_type, "self_report");
    assert.equal(store.get(questionnaire.questionnaire_id, 2).authentication_type, "self_report");
    const response = store.getResponse(questionnaire.questionnaire_id, draft.response_id);
    assert.equal(response.respondent, null);
    assert.equal(response.authentication_type, "self_report");
    assert.equal(response.identity_status, "legacy_missing");
    assert.equal(response.email_verified_at, null);
    store.close();
  }
  store = makeStore();
  await store.initialize();
  assert.equal(store.create({ title: "Fresh", questions }).authentication_type, "anonymous");
});

test("anonymous mode rejects respondent metadata but accepts contact-detail answers", () => {
  const questionnaire = store.create({ title: "Anon", questions });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { note: "x" }, ada),
    /anonymous/i,
  );
  const submitted = store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { note: "x", contact: "me@example.com" }, undefined);
  assert.equal(submitted.respondent, null);
  assert.equal(submitted.authentication_type, "anonymous");
  assert.equal(submitted.identity_status, "anonymous");
  assert.equal(submitted.email_verified_at, null);
  assert.equal(submitted.answers.contact, "me@example.com");
  assert.throws(() => store.submitNewResponse(questionnaire.questionnaire_id, undefined, ada, { note: "x" }), /anonymous/i);
  assert.equal(store.submitNewResponse(questionnaire.questionnaire_id, undefined, null, { note: "x" }).identity_status, "anonymous");
});

test("self_report requires name and email and records them as self-asserted", () => {
  const questionnaire = store.create({ title: "Self", authentication_type: "self_report", questions });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(() => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { note: "x" }, undefined), /respondent.*required/i);
  const submitted = store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { note: "x" }, ada);
  assert.deepEqual(submitted.respondent, ada);
  assert.equal(submitted.identity_status, "self_reported");
  assert.equal(submitted.email_verified_at, null);
  const listed = store.listResponses(questionnaire.questionnaire_id).responses[0];
  assert.equal(listed.authentication_type, "self_report");
  assert.equal(listed.identity_status, "self_reported");
});

test("email_verified completes only with a proof bound to the same response and email, then consumes it", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await assert.rejects(async () => submitDraft(questionnaire, draft, ada), /verif/i);
  assert.throws(() => store.submitNewResponse(questionnaire.questionnaire_id, undefined, ada, { note: "x" }), /verif/i);

  const sent = await requestCode(questionnaire, draft);
  assert.equal(sent.email, ada.email);
  assert.equal(sent.expires_at, new Date(now + 10 * 60_000).toISOString());
  assert.equal(sent.resend_available_at, new Date(now + 60_000).toISOString());
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.lastCode(), /^\d{6}$/);
  assert.equal(mailer.sent[0].to, ada.email);

  const code = mailer.lastCode();
  const wrong = code === "000000" ? "111111" : "000000";
  assert.throws(() => confirmCode(questionnaire, draft, wrong), /incorrect/i);
  assert.throws(() => confirmCode(questionnaire, draft, code, "eve@example.com"), /verification/i);
  const verified = confirmCode(questionnaire, draft, code);
  assert.match(verified.verification_proof, /^[a-f0-9]{64}$/);
  assert.throws(() => confirmCode(questionnaire, draft, code), /request a new code|no active/i, "codes are single use");

  // Proof cannot be moved to another response or another email.
  const other = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(() => submitDraft(questionnaire, other, ada, verified.verification_proof), /verif/i);
  assert.throws(() => submitDraft(questionnaire, draft, { name: "Ada", email: "eve@example.com" }, verified.verification_proof), /verif/i);

  const submitted = submitDraft(questionnaire, draft, { name: "Ada L.", email: "ada@EXAMPLE.com" }, verified.verification_proof);
  assert.equal(submitted.identity_status, "email_verified");
  assert.equal(submitted.email_verified_at, new Date(now).toISOString());
  assert.deepEqual(submitted.respondent, { name: "Ada L.", email: "ada@example.com" });
  assert.throws(() => submitDraft(questionnaire, draft, ada, verified.verification_proof), /already submitted/i);

  // Secrets are only stored hashed.
  const db = new DatabaseSync(path.join(root, "data", "questionnaire", "questionnaires.sqlite3"));
  const dump = JSON.stringify(db.prepare("SELECT * FROM questionnaire_email_verifications").all());
  const sends = JSON.stringify(db.prepare("SELECT * FROM questionnaire_email_sends").all());
  db.close();
  assert.doesNotMatch(dump, new RegExp(verified.verification_proof));
  assert.doesNotMatch(dump, new RegExp(`"${code}"`));
  assert.doesNotMatch(sends, /ada@example\.com|203\.0\.113\.7/);
});

test("a proof from one revision cannot finalize a response on another revision", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  const proof = confirmCode(questionnaire, draft, mailer.lastCode()).verification_proof;
  const revised = store.update(questionnaire.questionnaire_id, { title: "v2" });
  const later = store.createResponse(questionnaire.questionnaire_id, 2);
  assert.throws(() => submitDraft(revised, later, ada, proof), /verif/i);
  assert.throws(() => store.submitResponse(questionnaire.questionnaire_id, 2, draft.response_id, draft.edit_token, { note: "x" }, ada, undefined, { verificationProof: proof }), /not found/i);
});

test("verification codes expire after ten minutes and proofs expire too", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  const code = mailer.lastCode();
  now += 10 * 60_000 + 1;
  assert.throws(() => confirmCode(questionnaire, draft, code), /expired/i);

  now += 60_000;
  await requestCode(questionnaire, draft);
  const proof = confirmCode(questionnaire, draft, mailer.lastCode()).verification_proof;
  now += 31 * 60_000;
  assert.throws(() => submitDraft(questionnaire, draft, ada, proof), /expired|verif/i);
});

test("five failed attempts lock the code until a new one is sent", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  const code = mailer.lastCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) assert.throws(() => confirmCode(questionnaire, draft, wrong), /incorrect|too many/i);
  assert.throws(() => confirmCode(questionnaire, draft, code), (error) => error.status === 429 && /too many/i.test(error.message));
  now += 60_000;
  await requestCode(questionnaire, draft);
  assert.ok(confirmCode(questionnaire, draft, mailer.lastCode()).verification_proof);
});

test("resend cooldown is 60 seconds and resending or changing email invalidates the old code", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  const first = mailer.lastCode();
  now += 59_000;
  await assert.rejects(requestCode(questionnaire, draft), (error) => error.status === 429 && /wait/i.test(error.message));
  now += 1_000;
  await requestCode(questionnaire, draft, { name: "Ada", email: "ada2@example.com" });
  assert.equal(mailer.sent.at(-1).to, "ada2@example.com");
  assert.throws(() => confirmCode(questionnaire, draft, first, ada.email), /no active|request a new code|verification/i);
  if (first !== mailer.lastCode()) assert.throws(() => confirmCode(questionnaire, draft, first, "ada2@example.com"), /incorrect/i);
  assert.ok(confirmCode(questionnaire, draft, mailer.lastCode(), "ada2@example.com").verification_proof);
});

test("limits five sends per email per questionnaire per hour, counting failed deliveries", async () => {
  const questionnaire = verifiedForm();
  mailer.fail = true;
  const drafts = Array.from({ length: 6 }, () => store.createResponse(questionnaire.questionnaire_id, 1));
  await assert.rejects(requestCode(questionnaire, drafts[0]), (error) => error.status === 502 && /not sent|could not be sent/i.test(error.message));
  mailer.fail = false;
  for (const draft of drafts.slice(1, 5)) await requestCode(questionnaire, draft, { name: "Ada", email: "ADA@example.com" }, `198.51.100.${drafts.indexOf(draft)}`);
  await assert.rejects(requestCode(questionnaire, drafts[5], ada, "198.51.100.99"), (error) => error.status === 429 && /hour/i.test(error.message));
  const elsewhere = store.create({ title: "Other", authentication_type: "email_verified", questions });
  await requestCode(elsewhere, store.createResponse(elsewhere.questionnaire_id, 1));
  now += 60 * 60_000 + 1;
  await requestCode(questionnaire, drafts[5]);
});

test("limits twenty sends per source IP per hour", async () => {
  const questionnaire = verifiedForm();
  for (let index = 0; index < 20; index += 1) {
    const draft = store.createResponse(questionnaire.questionnaire_id, 1);
    await requestCode(questionnaire, draft, { name: "P", email: `p${index}@example.com` });
  }
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await assert.rejects(requestCode(questionnaire, draft, { name: "P", email: "p99@example.com" }), (error) => error.status === 429);
  await requestCode(questionnaire, draft, { name: "P", email: "p99@example.com" }, "192.0.2.1");
});

test("reports unavailable delivery without falling back to self reporting", async () => {
  store.close();
  mailer = { configured: false, async sendVerificationCode() { throw new Error("should not send"); } };
  store = makeStore({ questionnaireMailer: mailer });
  await store.initialize();
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await assert.rejects(requestCode(questionnaire, draft), (error) => error.status === 503 && /unavailable/i.test(error.message));
  assert.throws(() => submitDraft(questionnaire, draft, ada), /verif/i);
});

test("verification is refused for non-verified modes, submitted drafts and invalid edit tokens", async () => {
  const anon = store.create({ title: "Anon", questions });
  const draft = store.createResponse(anon.questionnaire_id, 1);
  await assert.rejects(requestCode(anon, draft), /does not use email verification/i);
  const questionnaire = verifiedForm();
  const verifiedDraft = store.createResponse(questionnaire.questionnaire_id, 1);
  await assert.rejects(requestCode(questionnaire, { ...verifiedDraft, edit_token: "0".repeat(64) }), /not found/i);
  await assert.rejects(requestCode(questionnaire, verifiedDraft, { name: "", email: "bad" }), /respondent/i);
});

test("expired verification rows and old send records are cleaned up", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  now += 2 * 60 * 60_000;
  const other = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, other, { name: "B", email: "b@example.com" });
  const db = new DatabaseSync(path.join(root, "data", "questionnaire", "questionnaires.sqlite3"));
  const challenges = db.prepare("SELECT response_id FROM questionnaire_email_verifications").all().map((row) => row.response_id);
  const sends = Number(db.prepare("SELECT count(*) AS n FROM questionnaire_email_sends").get().n);
  db.close();
  assert.deepEqual(challenges, [other.response_id]);
  assert.equal(sends, 1);
});

test("one email may verify several responses", async () => {
  const questionnaire = verifiedForm();
  for (let index = 0; index < 2; index += 1) {
    const draft = store.createResponse(questionnaire.questionnaire_id, 1);
    await requestCode(questionnaire, draft);
    const proof = confirmCode(questionnaire, draft, mailer.lastCode()).verification_proof;
    assert.equal(submitDraft(questionnaire, draft, ada, proof).identity_status, "email_verified");
    now += 60_000;
  }
  assert.equal(store.listResponses(questionnaire.questionnaire_id, { status: "submitted" }).total, 2);
});

test("MCP-channel verification creates its own draft and cannot touch browser drafts", async () => {
  const questionnaire = verifiedForm();
  const started = await store.requestMcpEmailVerification({ questionnaireId: questionnaire.questionnaire_id, respondent: ada, sourceIp: "mcp" });
  assert.match(started.response_id, /^[A-Za-z0-9]{24}$/);
  assert.equal(started.revision, 1);
  const proof = store.confirmMcpEmailVerification({ questionnaireId: questionnaire.questionnaire_id, responseId: started.response_id, email: ada.email, code: mailer.lastCode() }).verification_proof;
  const browserDraft = store.createResponse(questionnaire.questionnaire_id, 1);
  await assert.rejects(store.requestMcpEmailVerification({ questionnaireId: questionnaire.questionnaire_id, responseId: browserDraft.response_id, respondent: ada, sourceIp: "mcp" }), /not found/i);
  assert.throws(() => store.submitMcpVerifiedResponse({ questionnaireId: questionnaire.questionnaire_id, responseId: started.response_id, respondent: ada, answers: { note: "x" }, verificationProof: "f".repeat(64) }), /verif/i);
  const submitted = store.submitMcpVerifiedResponse({ questionnaireId: questionnaire.questionnaire_id, responseId: started.response_id, respondent: ada, answers: { note: "x" }, verificationProof: proof });
  assert.equal(submitted.identity_status, "email_verified");
  assert.throws(() => store.submitMcpVerifiedResponse({ questionnaireId: questionnaire.questionnaire_id, responseId: started.response_id, respondent: ada, answers: { note: "x" }, verificationProof: proof }), /already submitted/i);
});

test("confirmation is refused after the questionnaire closes", async () => {
  const questionnaire = verifiedForm();
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  await requestCode(questionnaire, draft);
  store.setStatus(questionnaire.questionnaire_id, "closed");
  assert.throws(() => confirmCode(questionnaire, draft, mailer.lastCode()), (error) => error.status === 409 && /closed/.test(error.message));
});

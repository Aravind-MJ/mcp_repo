import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { QuestionnaireStore, generateQuestionnaireId } from "../src/questionnaire/store.js";

let root;
let store;

const questions = [
  { id: "name", type: "short_text", title: "Your name", required: true, validation: { min_length: 2, max_length: 80 } },
  { id: "email", type: "email", title: "Email", required: true },
  { id: "bio", type: "long_text", title: "Tell us more", placeholder: "A few sentences" },
  { id: "site", type: "url", title: "Website" },
  { id: "phone", type: "phone", title: "Phone" },
  { id: "age", type: "number", title: "Age", validation: { min: 18, max: 120 } },
  { id: "date", type: "date", title: "Preferred date" },
  { id: "time", type: "time", title: "Preferred time" },
  { id: "meeting", type: "datetime", title: "Preferred meeting" },
  { id: "plan", type: "single_choice", title: "Plan", options: [{ value: "starter", label: "Starter" }, { value: "pro", label: "Pro" }] },
  { id: "topics", type: "multiple_choice", title: "Topics", options: [{ value: "api", label: "API" }, { value: "ui", label: "UI" }], validation: { min_selections: 1 } },
  { id: "country", type: "dropdown", title: "Country", options: [{ value: "in", label: "India" }, { value: "uk", label: "United Kingdom" }] },
  { id: "recommend", type: "yes_no", title: "Would you recommend us?" },
  { id: "consent", type: "consent", title: "I agree", required: true },
  { id: "rating", type: "rating", title: "Rate the experience", settings: { max: 5, icon: "star" } },
  { id: "score", type: "scale", title: "Likelihood", settings: { min: 0, max: 10, min_label: "Not likely", max_label: "Very likely" } },
  { id: "priority", type: "ranking", title: "Rank priorities", options: [{ value: "speed", label: "Speed" }, { value: "quality", label: "Quality" }] },
  { id: "matrix", type: "matrix", title: "Evaluate", rows: [{ value: "docs", label: "Documentation" }], options: [{ value: "poor", label: "Poor" }, { value: "great", label: "Great" }] },
];

const respondent = { name: "Aravind M J", email: "aravind@example.com" };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-store-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "s".repeat(64), { mode: 0o600 });
  store = new QuestionnaireStore({
    dataDir: path.join(root, "data"),
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
  });
  await store.initialize();
});

afterEach(async () => {
  store?.close();
  await rm(root, { recursive: true, force: true });
});

test("uses uniformly random alphanumeric questionnaire IDs", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateQuestionnaireId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{24}$/);
});

test("creates and revisions a questionnaire without mutating prior revisions", async () => {
  const created = await store.create({
    title: " Product discovery ",
    description: "Help us prioritize.",
    questions,
    settings: { submit_label: "Send feedback", completion_message: "Thank you." },
  });
  assert.match(created.questionnaire_id, /^[A-Za-z0-9]{24}$/);
  assert.equal(created.revision, 1);
  assert.equal(created.title, "Product discovery");
  assert.equal(created.questions.length, questions.length);
  assert.equal(created.status, "open");

  const updated = await store.update(created.questionnaire_id, {
    title: "Product discovery v2",
    questions: questions.slice(0, 2),
    settings: { submit_label: "Finish" },
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.title, "Product discovery v2");
  assert.equal((await store.get(created.questionnaire_id, 1)).title, "Product discovery");
  assert.equal((await store.get(created.questionnaire_id, 1)).questions.length, questions.length);
  assert.equal((await store.get(created.questionnaire_id)).revision, 2);
  assert.equal(updated.settings.submit_label, "Finish");
  assert.equal(updated.settings.completion_message, "Thank you.");
  assert.equal(updated.settings.accent_color, "#6d5dfc");
  assert.equal(updated.settings.show_progress, true);
});

test("validates question definitions and rejects duplicate IDs", async () => {
  assert.throws(
    () => store.create({ title: "Bad", questions: [{ id: "same", type: "short_text", title: "One" }, { id: "same", type: "short_text", title: "Two" }] }),
    /unique/,
  );
  assert.throws(
    () => store.create({ title: "Bad", questions: [{ id: "choice", type: "single_choice", title: "Pick" }] }),
    /options/,
  );
  assert.throws(
    () => store.create({
      title: "Impossible",
      questions: [{
        id: "choices",
        type: "multiple_choice",
        title: "Choose",
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
        validation: { min_selections: 3 },
      }],
    }),
    /min_selections.*available options/,
  );
  assert.throws(
    () => store.create({ title: "Bad", questions: [{ id: "unknown", type: "file", title: "Upload" }] }),
    /Unsupported question type/,
  );
  const many = (count) => Array.from({ length: count }, (_, index) => ({ value: `v${index}`, label: `Value ${index}` }));
  assert.throws(
    () => store.create({ title: "Oversized ranking", questions: [{ id: "rank", type: "ranking", title: "Rank", options: many(31) }] }),
    /between 2 and 30 items/,
  );
  assert.throws(
    () => store.create({ title: "Oversized matrix", questions: [{ id: "grid", type: "matrix", title: "Grid", options: many(13), rows: many(1) }] }),
    /between 2 and 12 items/,
  );
  assert.throws(
    () => store.create({ title: "Oversized matrix", questions: [{ id: "grid", type: "matrix", title: "Grid", options: many(2), rows: many(31) }] }),
    /between 1 and 30 items/,
  );
});

test("normalizes nested conditional questions and counts every level toward the limit", () => {
  const questionnaire = store.create({
    title: "Conditional follow-up",
    questions: [{
      id: "decision",
      type: "single_choice",
      title: "Choose a direction",
      required: true,
      options: [{ value: "keep", label: "Keep it" }, { value: "change", label: "Change it" }],
      children: [{
        id: "change_detail",
        type: "long_text",
        title: "What should change?",
        required: true,
        show_when: ["change"],
        children: [{ id: "change_reason", type: "short_text", title: "Why?" }],
      }],
    }],
  });

  assert.deepEqual(questionnaire.questions[0].children[0].show_when, ["change"]);
  assert.equal(questionnaire.questions[0].children[0].children[0].id, "change_reason");
  store.config.maxQuestions = 2;
  assert.throws(
    () => store.create({ title: "Too many nested fields", questions: questionnaire.questions }),
    /between 1 and 2 items/,
  );
});

test("rejects invalid nested conditions, excessive nesting, and duplicate IDs across the tree", () => {
  const parent = {
    id: "decision",
    type: "single_choice",
    title: "Choose",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
  };
  assert.throws(
    () => store.create({ title: "Duplicate", questions: [{ ...parent, children: [{ id: "decision", type: "short_text", title: "Again" }] }] }),
    /unique/,
  );
  assert.throws(
    () => store.create({ title: "Unknown condition", questions: [{ ...parent, children: [{ id: "detail", type: "short_text", title: "Detail", show_when: ["maybe"] }] }] }),
    /show_when.*available parent answer/i,
  );
  assert.throws(
    () => store.create({ title: "Root condition", questions: [{ ...parent, show_when: ["yes"] }] }),
    /show_when.*nested/i,
  );
  let question = { id: "level_9", type: "short_text", title: "Level 9" };
  for (let depth = 8; depth >= 1; depth -= 1) question = { id: `level_${depth}`, type: "short_text", title: `Level ${depth}`, children: [question] };
  assert.throws(() => store.create({ title: "Too deep", questions: [question] }), /nesting.*8 levels/i);
});

test("requires only active nested questions and removes inactive branch answers", () => {
  const questionnaire = store.create({
    title: "Conditional response",
    questions: [{
      id: "decision",
      type: "single_choice",
      title: "Choose",
      required: true,
      options: [{ value: "keep", label: "Keep" }, { value: "change", label: "Change" }],
      children: [{ id: "detail", type: "long_text", title: "Explain", required: true, show_when: ["change"] }],
    }],
  });

  const keep = store.createResponse(questionnaire.questionnaire_id, 1);
  const kept = store.submitResponse(questionnaire.questionnaire_id, 1, keep.response_id, keep.edit_token, { decision: "keep", detail: "Must not survive" }, respondent);
  assert.deepEqual(kept.answers, { decision: "keep" });

  const change = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, change.response_id, change.edit_token, { decision: "change" }, respondent),
    /detail.*required/,
  );
  const changed = store.submitResponse(questionnaire.questionnaire_id, 1, change.response_id, change.edit_token, { decision: "change", detail: "Use the new rule" }, respondent);
  assert.equal(changed.answers.detail, "Use the new rule");
});

test("keeps nested definitions immutable across revisions", () => {
  const created = store.create({
    title: "Nested revisions",
    questions: [{
      id: "choice",
      type: "yes_no",
      title: "Continue?",
      children: [{ id: "reason", type: "short_text", title: "Reason", show_when: ["yes"] }],
    }],
  });
  store.update(created.questionnaire_id, { questions: [{ id: "replacement", type: "short_text", title: "Replacement" }] });
  assert.equal(store.get(created.questionnaire_id, 1).questions[0].children[0].id, "reason");
  assert.equal(store.get(created.questionnaire_id, 2).questions[0].id, "replacement");
});

test("keeps drafts anonymous, then requires and records respondent identity on submission", async () => {
  const questionnaire = await store.create({ title: "Small", questions: questions.slice(0, 2) });
  const draft = await store.createResponse(questionnaire.questionnaire_id, 1);
  assert.match(draft.response_id, /^[A-Za-z0-9]{24}$/);
  assert.match(draft.edit_token, /^[a-f0-9]{64}$/);
  assert.equal(draft.status, "draft");

  const partial = await store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Aravind" });
  assert.equal(partial.answers.name, "Aravind");
  assert.equal(partial.status, "draft");
  assert.equal(partial.respondent, null);

  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "A", email: "bad" }, respondent),
    /name|email/,
  );

  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Aravind", email: "hello@example.com" }),
    /respondent.*required/i,
  );
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Aravind", email: "hello@example.com" }, { name: "Ada", email: "not-an-email" }),
    /respondent email.*valid/i,
  );

  const submitted = await store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Aravind", email: "hello@example.com" }, { name: "  Ada   Lovelace  ", email: " ADA@Example.COM " });
  assert.equal(submitted.status, "submitted");
  assert.deepEqual(submitted.respondent, { name: "Ada Lovelace", email: "ADA@example.com" });
  assert.ok(submitted.submitted_at);
  assert.throws(
    () => store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "Changed" }),
    /already submitted/,
  );

  const listed = await store.listResponses(questionnaire.questionnaire_id, { status: "submitted" });
  assert.equal(listed.responses.length, 1);
  assert.deepEqual(listed.responses[0].respondent, { name: "Ada Lovelace", email: "ADA@example.com" });
  assert.equal("answers" in listed.responses[0], false);
  assert.equal(store.getResponse(questionnaire.questionnaire_id, draft.response_id).answers.email, "hello@example.com");
  assert.deepEqual(store.getResponse(questionnaire.questionnaire_id, draft.response_id).respondent, { name: "Ada Lovelace", email: "ADA@example.com" });
  assert.equal("edit_token" in listed.responses[0], false);
});

test("migrates historical response rows before recording respondent identity", async () => {
  const questionnaire = store.create({ title: "Legacy", questions: [questions[0]] });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  const config = store.config;
  const databasePath = path.join(config.dataDir, "questionnaire", "questionnaires.sqlite3");

  store.close();
  store = null;
  const legacy = new DatabaseSync(databasePath);
  legacy.exec("ALTER TABLE responses DROP COLUMN respondent_name; ALTER TABLE responses DROP COLUMN respondent_email;");
  legacy.close();

  store = new QuestionnaireStore(config);
  await store.initialize();
  assert.equal(store.getResponse(questionnaire.questionnaire_id, draft.response_id).respondent, null);
  const submitted = store.submitResponse(
    questionnaire.questionnaire_id,
    1,
    draft.response_id,
    draft.edit_token,
    { name: "Legacy respondent" },
    respondent,
  );
  assert.deepEqual(submitted.respondent, respondent);
});

test("rejects stale response versions instead of overwriting another tab", () => {
  const questionnaire = store.create({ title: "Concurrent", questions: [questions[2]] });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.equal(draft.version, 0);
  const first = store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { bio: "First tab" }, 0);
  assert.equal(first.version, 1);
  assert.throws(
    () => store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { bio: "Stale tab" }, 0),
    /changed in another tab/i,
  );
  assert.equal(store.getResponse(questionnaire.questionnaire_id, draft.response_id).answers.bio, "First tab");
});

test("rejects whitespace-only required text answers", () => {
  const questionnaire = store.create({ title: "Required text", questions: [questions[0]] });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { name: "   \n  " }, respondent),
    /required/,
  );
});

test("lists response metadata in stable creation order and validates targets", () => {
  const questionnaire = store.create({ title: "Stable list", questions: [questions[2]] });
  const drafts = Array.from({ length: 3 }, () => store.createResponse(questionnaire.questionnaire_id, 1));
  store.db.prepare("UPDATE responses SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:01.000Z", drafts[0].response_id);
  store.db.prepare("UPDATE responses SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-01-01T00:00:02.000Z", "2026-01-01T00:00:02.000Z", drafts[1].response_id);
  store.db.prepare("UPDATE responses SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-01-01T00:00:03.000Z", "2026-01-01T00:00:03.000Z", drafts[2].response_id);

  const firstPage = store.listResponses(questionnaire.questionnaire_id, { limit: 2 });
  store.saveResponse(questionnaire.questionnaire_id, 1, drafts[0].response_id, drafts[0].edit_token, { bio: "Still here" });
  const secondPage = store.listResponses(questionnaire.questionnaire_id, { limit: 2, offset: 2 });
  assert.deepEqual(firstPage.responses.map((response) => response.response_id), [drafts[2].response_id, drafts[1].response_id]);
  assert.deepEqual(secondPage.responses.map((response) => response.response_id), [drafts[0].response_id]);
  assert.equal(firstPage.responses.some((response) => "answers" in response), false);
  assert.throws(() => store.listResponses("A".repeat(24)), /not found/i);
  assert.throws(() => store.listResponses(questionnaire.questionnaire_id, { revision: 99 }), /revision not found/i);
});

test("setting an unchanged questionnaire status is observably idempotent", () => {
  const questionnaire = store.create({ title: "Status", questions: [questions[0]] });
  store.db.prepare("UPDATE questionnaires SET updated_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", questionnaire.questionnaire_id);
  const unchanged = store.setStatus(questionnaire.questionnaire_id, "open");
  assert.equal(unchanged.updated_at, "2020-01-01T00:00:00.000Z");
});

test("autosaves incomplete typed values but enforces their rules on final submission", () => {
  const questionnaire = store.create({ title: "Typing", questions: questions.slice(0, 5) });
  const draft = store.createResponse(questionnaire.questionnaire_id, 1);
  const saved = store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, {
    name: "A",
    email: "still typing",
    site: "https://",
    phone: "+",
  });
  assert.equal(saved.answers.email, "still typing");
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, saved.answers, respondent),
    /name|email|site|phone/,
  );
});

test("enforces number steps and rejects impossible local datetimes", () => {
  const questionnaire = store.create({
    title: "Scheduling",
    questions: [
      { id: "quantity", type: "number", title: "Quantity", required: true, validation: { min: 0.5, step: 0.25 } },
      { id: "starts_at", type: "datetime", title: "Starts at", required: true },
    ],
  });

  const badStep = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, badStep.response_id, badStep.edit_token, { quantity: 0.6, starts_at: "2026-02-28T09:30" }, respondent),
    /step/,
  );

  const badDate = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.submitResponse(questionnaire.questionnaire_id, 1, badDate.response_id, badDate.edit_token, { quantity: 0.75, starts_at: "2026-02-30T09:30" }, respondent),
    /valid date and time/,
  );

  const valid = store.createResponse(questionnaire.questionnaire_id, 1);
  assert.equal(store.submitResponse(questionnaire.questionnaire_id, 1, valid.response_id, valid.edit_token, { quantity: 0.75, starts_at: "2026-02-28T09:30" }, respondent).status, "submitted");
});

test("submits a complete identified response atomically without exposing an edit token", () => {
  const questionnaire = store.create({ title: "Agent answer", questions: [questions[0]] });
  const submitted = store.submitNewResponse(questionnaire.questionnaire_id, undefined, respondent, { name: "Agent answer" });
  assert.equal(submitted.status, "submitted");
  assert.deepEqual(submitted.respondent, respondent);
  assert.equal("edit_token" in submitted, false);
  assert.equal(store.listResponses(questionnaire.questionnaire_id).total, 1);

  assert.throws(
    () => store.submitNewResponse(questionnaire.questionnaire_id, undefined, respondent, {}),
    /name.*required/i,
  );
  assert.equal(store.listResponses(questionnaire.questionnaire_id).total, 1);
});

test("caps immutable revisions per questionnaire to bound public definition growth", () => {
  store.config.maxRevisionsPerQuestionnaire = 2;
  const questionnaire = store.create({ title: "Revision one", questions: questions.slice(0, 1) });
  store.update(questionnaire.questionnaire_id, { title: "Revision two" });
  assert.throws(() => store.update(questionnaire.questionnaire_id, { title: "Revision three" }), /revision limit/i);
});

test("caps responses per questionnaire to bound anonymous draft growth", () => {
  store.config.maxResponsesPerQuestionnaire = 2;
  const questionnaire = store.create({ title: "Bounded", questions: questions.slice(0, 1) });
  store.createResponse(questionnaire.questionnaire_id, 1);
  store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(() => store.createResponse(questionnaire.questionnaire_id, 1), /response limit/i);
});

test("rejects invalid edit tokens, unknown answers, closed forms, and deletes cascaded responses", async () => {
  const questionnaire = await store.create({ title: "Small", questions: questions.slice(0, 2) });
  const draft = await store.createResponse(questionnaire.questionnaire_id, 1);
  assert.throws(
    () => store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, "0".repeat(64), { name: "No" }),
    /not found/,
  );
  assert.throws(
    () => store.saveResponse(questionnaire.questionnaire_id, 1, draft.response_id, draft.edit_token, { extra: "No" }),
    /Unknown question/,
  );

  await store.setStatus(questionnaire.questionnaire_id, "closed");
  assert.throws(() => store.createResponse(questionnaire.questionnaire_id, 1), /closed/);
  await store.setStatus(questionnaire.questionnaire_id, "open");
  assert.equal((await store.get(questionnaire.questionnaire_id)).status, "open");

  await store.delete(questionnaire.questionnaire_id);
  assert.throws(() => store.get(questionnaire.questionnaire_id), /not found/);
  assert.throws(() => store.listResponses(questionnaire.questionnaire_id), /not found/);
});

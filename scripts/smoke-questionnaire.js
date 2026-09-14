#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const secret = (await readFile(config.secretFile, "utf8")).trim();
const baseUrl = (process.env.QUESTIONNAIRE_MCP_BASE_URL || config.publicBaseUrl).replace(/\/+$/, "");
const keep = process.argv.includes("--keep");
const client = new Client({ name: "questionnaire-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/questionnaire/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${secret}` } },
}));

const options = [{ value: "starter", label: "Starter" }, { value: "pro", label: "Professional" }];
const questions = [
  { id: "name", type: "short_text", title: "What should we call you?", description: "A first name is enough.", required: true, placeholder: "Your name" },
  { id: "story", type: "long_text", title: "What are you hoping to accomplish?", validation: { max_length: 1200 } },
  { id: "email", type: "email", title: "Email address" },
  { id: "site", type: "url", title: "Website" },
  { id: "phone", type: "phone", title: "Phone number" },
  { id: "team_size", type: "number", title: "Team size", validation: { min: 1, max: 10000 } },
  { id: "start_date", type: "date", title: "Ideal start date" },
  { id: "start_time", type: "time", title: "Preferred call time" },
  { id: "meeting", type: "datetime", title: "Best date and time" },
  { id: "plan", type: "single_choice", title: "Which path fits best?", required: true, options, children: [{ id: "pro_goal", type: "long_text", title: "What should Professional unlock?", required: true, show_when: ["pro"] }] },
  { id: "topics", type: "multiple_choice", title: "What matters most?", options: [{ value: "speed", label: "Speed" }, { value: "quality", label: "Quality" }, { value: "support", label: "Support" }], validation: { max_selections: 2 } },
  { id: "region", type: "dropdown", title: "Region", options: [{ value: "apac", label: "Asia Pacific" }, { value: "emea", label: "Europe, Middle East & Africa" }, { value: "americas", label: "Americas" }] },
  { id: "recommend", type: "yes_no", title: "Would you recommend this form?" },
  { id: "consent", type: "consent", title: "I agree to submit this response", required: true },
  { id: "rating", type: "rating", title: "Rate the experience", settings: { max: 5, icon: "star" } },
  { id: "score", type: "scale", title: "How likely are you to continue?", settings: { min: 0, max: 10, min_label: "Not likely", max_label: "Very likely" } },
  { id: "priorities", type: "ranking", title: "Rank your priorities", options: [{ value: "speed", label: "Speed" }, { value: "quality", label: "Quality" }, { value: "cost", label: "Cost" }] },
  { id: "experience", type: "matrix", title: "Evaluate the experience", rows: [{ value: "clarity", label: "Clarity" }, { value: "pace", label: "Pace" }], options: [{ value: "needs_work", label: "Needs work" }, { value: "good", label: "Good" }, { value: "excellent", label: "Excellent" }] },
];

let questionnaireId;
let responseId;
let mcpResponseId;
try {
  const created = (await client.callTool({ name: "create_questionnaire", arguments: {
    title: "Questionnaire experience check",
    description: "A comprehensive preview of every supported answer type, autosave, and responsive interaction.",
    questions,
    settings: { submit_label: "Send my response", completion_message: "Your answers are safely recorded.", accent_color: "#6d5dfc" },
  } })).structuredContent;
  questionnaireId = created.questionnaire_id;
  assert.match(questionnaireId, /^[A-Za-z0-9]{24}$/);
  assert.equal(created.revision, 1);
  assert.doesNotMatch(created.url, /\/r\/1\?/);
  assert.match(created.url, /expires=\d+&signature=[a-f0-9]{64}$/);

  const updated = (await client.callTool({ name: "update_questionnaire", arguments: {
    questionnaire_id: questionnaireId,
    title: "Questionnaire experience check — latest",
  } })).structuredContent;
  assert.equal(updated.revision, 2);
  assert.equal(new URL(updated.url).pathname, new URL(created.url).pathname);

  const page = await fetch(created.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("x-robots-tag"), /noindex/);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Questionnaire experience check — latest/);
  assert.match(pageHtml, /data-parent-question="plan"/);
  assert.doesNotMatch(pageHtml, /Response form · Revision/);

  const definitionMatch = pageHtml.match(/<script type="application\/json" id="questionnaire-data">([\s\S]*?)<\/script>/);
  assert.ok(definitionMatch, "Questionnaire page must include its public definition");
  const publicDefinition = JSON.parse(definitionMatch[1]);
  assert.equal(publicDefinition.response_scope.revision, 2);
  assert.match(publicDefinition.response_scope.signature, /^[a-f0-9]{64}$/);

  const share = new URL(created.url);
  const endpoint = (suffix) => {
    const result = new URL(`${share.pathname}${suffix}`, share.origin);
    result.search = share.search;
    result.searchParams.set("response_revision", String(publicDefinition.response_scope.revision));
    result.searchParams.set("response_signature", publicDefinition.response_scope.signature);
    return result;
  };
  const draftResponse = await fetch(endpoint("/responses"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  responseId = draft.response_id;
  const headers = { "content-type": "application/json", "x-questionnaire-edit-token": draft.edit_token };
  const answers = { name: "Smoke test", plan: "pro", pro_goal: "Faster review", consent: true, priorities: ["quality", "speed", "cost"] };
  const autosaved = await fetch(endpoint(`/responses/${responseId}`), { method: "PATCH", headers, body: JSON.stringify({ answers }) });
  assert.equal(autosaved.status, 200);
  assert.equal((await autosaved.json()).answers.name, "Smoke test");
  const resumed = await fetch(endpoint(`/responses/${responseId}`), { headers: { "x-questionnaire-edit-token": draft.edit_token } });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).status, "draft");
  const submitted = await fetch(endpoint(`/responses/${responseId}/submit`), { method: "POST", headers, body: JSON.stringify({ answers, respondent: { name: "Browser smoke", email: "browser-smoke@example.com" } }) });
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  assert.equal(submittedBody.status, "submitted");
  assert.deepEqual(submittedBody.respondent, { name: "Browser smoke", email: "browser-smoke@example.com" });

  const mcpSubmitted = (await client.callTool({ name: "submit_questionnaire_response", arguments: {
    questionnaire_id: questionnaireId,
    respondent: { name: "MCP smoke", email: "mcp-smoke@example.com" },
    answers: { name: "MCP smoke", plan: "starter", consent: true },
  } })).structuredContent;
  mcpResponseId = mcpSubmitted.response_id;
  assert.equal(mcpSubmitted.status, "submitted");
  assert.deepEqual(mcpSubmitted.respondent, { name: "MCP smoke", email: "mcp-smoke@example.com" });
  assert.equal("edit_token" in mcpSubmitted, false);

  const listed = (await client.callTool({ name: "list_questionnaire_responses", arguments: { questionnaire_id: questionnaireId, status: "submitted" } })).structuredContent;
  assert.equal(listed.total, 2);
  assert.deepEqual(new Set(listed.responses.map((item) => item.response_id)), new Set([responseId, mcpResponseId]));
  assert.deepEqual(new Set(listed.responses.map((item) => item.respondent.email)), new Set(["browser-smoke@example.com", "mcp-smoke@example.com"]));

  const retrieved = (await client.callTool({ name: "get_questionnaire_response", arguments: { questionnaire_id: questionnaireId, response_id: mcpResponseId } })).structuredContent;
  assert.equal(retrieved.answers.plan, "starter");
  assert.equal(retrieved.respondent.name, "MCP smoke");

  console.log(`QUESTIONNAIRE_ID=${questionnaireId}`);
  console.log(`RESPONSE_ID=${responseId}`);
  console.log(`SHARE_URL=${created.url}`);
  console.log("SMOKE_STATUS=ok");
} finally {
  if (!keep && questionnaireId) {
    const deleted = (await client.callTool({ name: "delete_questionnaire", arguments: { questionnaire_id: questionnaireId } })).structuredContent;
    assert.equal(deleted.deleted, true);
    const remaining = (await client.callTool({ name: "list_questionnaires", arguments: { limit: 200 } })).structuredContent;
    assert.equal(remaining.questionnaires.some((item) => item.questionnaire_id === questionnaireId), false);
    console.log("SMOKE_CLEANUP=verified");
  }
  await client.close();
}

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
let questionnaireStore;
const sharedSecret = "s".repeat(64);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-mcp-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, sharedSecret, { mode: 0o600 });
  config = {
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(root, "data"),
    secretFile,
    publicBaseUrl: "https://mcp.example.test",
    maxHtmlBytes: 1024,
    maxListItems: 200,
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  };
  const created = await createApp(config);
  questionnaireStore = created.questionnaireStore;
  server = createServer(created.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  questionnaireStore?.close();
  await rm(root, { recursive: true, force: true });
});

async function mcpClient() {
  const client = new Client({ name: "questionnaire-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  return client;
}

const questions = [
  { id: "name", type: "short_text", title: "Name", required: true },
  { id: "score", type: "rating", title: "Rating", settings: { max: 5 } },
];

test("authenticated questionnaire MCP exposes management and answering tools", async () => {
  const client = await mcpClient();
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "create_questionnaire",
      "delete_questionnaire",
      "delete_questionnaire_response",
      "get_questionnaire",
      "get_questionnaire_response",
      "get_questionnaire_signed_url",
      "list_questionnaire_responses",
      "list_questionnaires",
      "set_questionnaire_status",
      "submit_questionnaire_response",
      "update_questionnaire",
    ]);
  } finally {
    await client.close();
  }
});

test("publishes type-aware question schemas to MCP clients", async () => {
  const client = await mcpClient();
  try {
    const tools = await client.listTools();
    const create = tools.tools.find((tool) => tool.name === "create_questionnaire");
    const schema = JSON.stringify(create.inputSchema);
    assert.match(schema, /anyOf|oneOf/);
    assert.match(schema, /min_selections/);
    assert.match(schema, /max_selections/);
    assert.match(schema, /min_length/);
    assert.match(schema, /rows/);
    assert.match(schema, /icon/);
    assert.match(schema, /min_label/);
    assert.match(schema, /children/);
    assert.match(schema, /show_when/);
    const branches = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.properties?.type?.const) branches.push(value);
      for (const child of Object.values(value)) visit(child);
    };
    visit(create.inputSchema);
    const byType = (type) => branches.find((branch) => branch.properties.type.const === type);
    assert.equal(byType("ranking").properties.options.maxItems, 30);
    assert.equal(byType("matrix").properties.options.maxItems, 12);
    assert.equal(byType("matrix").properties.rows.maxItems, 30);
    assert.match(schema, /200 questions across the entire tree/);
    assert.match(schema, /eight nesting levels/);
  } finally {
    await client.close();
  }
});

test("accepts nested conditional questions through the real MCP schema", async () => {
  const client = await mcpClient();
  try {
    const created = (await client.callTool({
      name: "create_questionnaire",
      arguments: {
        title: "Nested through MCP",
        questions: [{
          id: "decision",
          type: "single_choice",
          title: "Proceed?",
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
          children: [{ id: "reason", type: "long_text", title: "Why not?", show_when: ["no"] }],
        }],
      },
    })).structuredContent;
    assert.deepEqual(created.questions[0].children[0].show_when, ["no"]);
  } finally {
    await client.close();
  }
});

test("manages revisioned questionnaires and signed URLs through the real MCP protocol", async () => {
  const client = await mcpClient();
  try {
    const created = (await client.callTool({
      name: "create_questionnaire",
      arguments: { title: "Customer check-in", description: "Two quick questions.", questions },
    })).structuredContent;
    assert.match(created.questionnaire_id, /^[A-Za-z0-9]{24}$/);
    assert.equal(created.revision, 1);
    assert.equal(created.status, "open");
    assert.match(created.url, new RegExp(`/questionnaire/${created.questionnaire_id}\\?expires=\\d+&signature=[a-f0-9]{64}$`));
    assert.equal(created.canonical_url, `${questionnaireStore.config.publicBaseUrl}/questionnaire/${created.questionnaire_id}`);
    assert.equal(created.expires_in_seconds, 604800);

    const updated = (await client.callTool({
      name: "update_questionnaire",
      arguments: { questionnaire_id: created.questionnaire_id, title: "Customer check-in v2" },
    })).structuredContent;
    assert.equal(updated.revision, 2);
    assert.equal(updated.title, "Customer check-in v2");
    assert.doesNotMatch(updated.url, /\/r\/2\?/);

    const revisionOne = (await client.callTool({ name: "get_questionnaire", arguments: { questionnaire_id: created.questionnaire_id, revision: 1 } })).structuredContent;
    assert.equal(revisionOne.title, "Customer check-in");
    assert.match(revisionOne.url, /\/r\/1\?expires=/);
    const listed = (await client.callTool({ name: "list_questionnaires", arguments: {} })).structuredContent;
    assert.equal(listed.questionnaires[0].questionnaire_id, created.questionnaire_id);

    const customShare = (await client.callTool({
      name: "get_questionnaire_signed_url",
      arguments: { questionnaire_id: created.questionnaire_id, revision: 1, expires_in_seconds: 3600 },
    })).structuredContent;
    assert.equal(customShare.revision, 1);
    assert.equal(customShare.expires_in_seconds, 3600);

    const closed = (await client.callTool({ name: "set_questionnaire_status", arguments: { questionnaire_id: created.questionnaire_id, status: "closed" } })).structuredContent;
    assert.equal(closed.status, "closed");
    const reopened = (await client.callTool({ name: "set_questionnaire_status", arguments: { questionnaire_id: created.questionnaire_id, status: "open" } })).structuredContent;
    assert.equal(reopened.status, "open");

    const submitted = (await client.callTool({
      name: "submit_questionnaire_response",
      arguments: {
        questionnaire_id: created.questionnaire_id,
        revision: 1,
        respondent: { name: "  Aravind   M J  ", email: " ARAVIND@Example.COM " },
        answers: { name: "Aravind", score: 5 },
      },
    })).structuredContent;
    assert.equal(submitted.status, "submitted");
    assert.deepEqual(submitted.respondent, { name: "Aravind M J", email: "ARAVIND@example.com" });
    assert.equal("edit_token" in submitted, false);
    const responses = (await client.callTool({ name: "list_questionnaire_responses", arguments: { questionnaire_id: created.questionnaire_id, status: "submitted" } })).structuredContent;
    assert.equal(responses.total, 1);
    assert.deepEqual(responses.responses[0].respondent, submitted.respondent);
    assert.equal("answers" in responses.responses[0], false);
    assert.equal("edit_token" in responses.responses[0], false);

    const response = (await client.callTool({ name: "get_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, response_id: submitted.response_id } })).structuredContent;
    assert.equal(response.answers.score, 5);
    assert.deepEqual(response.respondent, submitted.respondent);
    const deletedResponse = (await client.callTool({ name: "delete_questionnaire_response", arguments: { questionnaire_id: created.questionnaire_id, response_id: submitted.response_id } })).structuredContent;
    assert.equal(deletedResponse.deleted, true);

    const deleted = (await client.callTool({ name: "delete_questionnaire", arguments: { questionnaire_id: created.questionnaire_id } })).structuredContent;
    assert.equal(deleted.deleted, true);
  } finally {
    await client.close();
  }
});

test("Artifact and Questionnaire MCP enforce the configured bearer secret", async () => {
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  for (const endpoint of ["artifact", "questionnaire"]) {
    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const response = await fetch(`${baseUrl}/${endpoint}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(initialize),
      });
      assert.equal(response.status, 401, `${endpoint} rejects ${authorization ? "wrong" : "missing"} credentials`);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="personal-mcp-hub"');
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    const authenticated = await fetch(`${baseUrl}/${endpoint}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${sharedSecret}`,
      },
      body: JSON.stringify(initialize),
    });
    assert.equal(authenticated.status, 200, `${endpoint} accepts the shared credential`);
  }
});

test("reserves the questionnaire MCP path for protocol method handling", async () => {
  const response = await fetch(`${baseUrl}/questionnaire/mcp`, {
    headers: { authorization: `Bearer ${sharedSecret}` },
  });
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

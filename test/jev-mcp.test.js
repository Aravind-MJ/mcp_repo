import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { JevClient } from "../src/jev/client.js";

let root;
let server;
let baseUrl;
let config;
let originalFetch;
const sharedSecret = "s".repeat(64);
const firstOpenRouterKey = "sk-or-v1-first-test-key";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "jev-mcp-test-"));
  const secretDirectory = path.join(root, "secrets");
  const secretFile = path.join(secretDirectory, "shared-secret");
  const openRouterApiKeyFile = path.join(secretDirectory, "openrouter-api-key");
  await mkdir(secretDirectory, { recursive: true });
  await writeFile(secretFile, sharedSecret, { mode: 0o600 });
  await writeFile(openRouterApiKeyFile, firstOpenRouterKey, { mode: 0o600 });
  config = {
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(root, "data"),
    secretFile,
    openRouterApiKeyFile,
    publicBaseUrl: "https://mcp.example.test",
    maxHtmlBytes: 1024,
    maxListItems: 200,
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  };
  originalFetch = globalThis.fetch;
  const created = await createApp(config);
  server = createServer(created.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function mcpClient() {
  const client = new Client({ name: "jev-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/jev/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  return client;
}

const questions = {
  is_bug: {
    type: "noul",
    instructions: "Is the customer reporting a software defect?",
    criteria: {
      true: "The customer describes broken or unexpected product behavior.",
      false: "The customer is asking a question or requesting a feature.",
    },
  },
  team: {
    type: "choice",
    instructions: "Which team should own this ticket?",
    criteria: {
      payments: "Checkout, billing, or payment processing issues.",
      frontend: "Rendering, layout, or browser compatibility issues.",
    },
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this ticket?",
    criteria: ["Can wait", "Should be fixed this week", "Blocking revenue"],
  },
};

test("authenticated Jev MCP forwards typed decisions and reloads the upstream key", async () => {
  const authorizations = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    authorizations.push(options.headers.Authorization);
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "typesafe/jev-1.13");
    assert.deepEqual(request.state, { ticket: "Checkout is blank" });
    assert.deepEqual(request.questions, questions);
    return Response.json({
      id: "gen-dec-test",
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      answers: {
        is_bug: { type: "noul", noul: 0.96 },
        team: { type: "choice", choice: "payments", confidence: 0.67, probabilities: { payments: 0.78, frontend: 0.22 } },
        urgency: { type: "score", score: 1.99, confidence: 0.99, probabilities: { 0: 0, 1: 0, 2: 1 }, legend: { 0: "Can wait", 1: "Should be fixed this week", 2: "Blocking revenue" } },
      },
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
    });
  };

  const client = await mcpClient();
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["make_decisions"]);
    assert.equal(tools.tools[0].outputSchema.type, "object");
    assert.ok(tools.tools[0].outputSchema.properties.answers);
    const result = await client.callTool({
      name: "make_decisions",
      arguments: { state: { ticket: "Checkout is blank" }, questions },
    });
    assert.equal(result.structuredContent.answers.is_bug.noul, 0.96);
    assert.equal(result.structuredContent.answers.team.choice, "payments");
    assert.equal(result.structuredContent.usage.cost, 0.000019992);

    const rotated = "sk-or-v1-rotated-test-key";
    await writeFile(config.openRouterApiKeyFile, rotated, { mode: 0o600 });
    await client.callTool({ name: "make_decisions", arguments: { state: { ticket: "Checkout is blank" }, questions } });
    assert.deepEqual(authorizations, [`Bearer ${firstOpenRouterKey}`, `Bearer ${rotated}`]);
  } finally {
    await client.close();
  }
});

test("Jev endpoint shares hub authentication and exposes secret-free resources", async () => {
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  for (const authorization of [undefined, "Bearer wrong-secret"]) {
    const response = await originalFetch(`${baseUrl}/jev/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 401);
  }

  const health = await (await originalFetch(`${baseUrl}/healthz`)).json();
  assert.equal(health.status, "ok");
  assert.ok(health.modules.includes("jev"));

  const readme = await originalFetch(`${baseUrl}/jev/README.md`);
  const readmeText = await readme.text();
  assert.equal(readme.status, 200);
  assert.match(readmeText, /aravind_jev_decisions/);
  assert.match(readmeText, /typesafe\/jev-1\.13/);
  assert.doesNotMatch(readmeText, new RegExp(firstOpenRouterKey));

  const skill = await originalFetch(`${baseUrl}/jev/SKILL.md`);
  const skillText = await skill.text();
  assert.equal(skill.status, 200);
  assert.match(skillText, /^---\nname: aravind-jev-decisions/m);
  assert.match(skillText, /make_decisions/);
  assert.doesNotMatch(skillText, new RegExp(firstOpenRouterKey));
});

test("upstream errors become bounded MCP errors without leaking credentials", async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return Response.json({ error: { message: `Insufficient credits for ${options.headers.Authorization}` } }, { status: 402 });
  };
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /OpenRouter Decisions request failed with HTTP 402/);
    assert.doesNotMatch(result.content[0].text, new RegExp(firstOpenRouterKey));
  } finally {
    await client.close();
  }
});

test("rejects malformed and oversized upstream decision responses", async () => {
  const malformed = new JevClient({
    apiKeyFile: config.openRouterApiKeyFile,
    fetchFn: async () => Response.json({
      model: "typesafe/jev-1.13-20260917",
      answers: { team: { type: "choice", choice: "undeclared", probabilities: { undeclared: 1 } } },
    }),
  });
  await assert.rejects(
    () => malformed.makeDecisions({ state: "hello", questions: { team: questions.team } }),
    /invalid response/,
  );

  const oversized = new JevClient({
    apiKeyFile: config.openRouterApiKeyFile,
    fetchFn: async () => new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }),
  });
  await assert.rejects(
    () => oversized.makeDecisions({ state: "hello", questions: { relevant: questions.is_bug } }),
    /size limit/,
  );
});

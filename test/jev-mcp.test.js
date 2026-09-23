import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { JevAuditLog } from "../src/jev/audit.js";
import { JevClient } from "../src/jev/client.js";

let root;
let server;
let baseUrl;
let config;
let originalFetch;
let auditLog;
const sharedSecret = "s".repeat(64);
const firstOpenRouterKey = "sk-or-v1-first-test-key";
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
  auditLog = created.jevAuditLog;
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
  auditLog?.close();
  await rm(root, { recursive: true, force: true });
});

async function mcpClient() {
  const client = new Client({ name: "jev-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/jev/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  return client;
}

function toolCall(id, name, args) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function postJsonRpc(body, headers = {}, signal = undefined) {
  return originalFetch(`${baseUrl}/jev/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sharedSecret}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function eventually(read, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Condition was not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

  const { calls, total } = auditLog.list();
  assert.equal(total, 1);
  const [call] = calls;
  assert.equal(call.status, "failure");
  assert.equal(call.error_message, "OpenRouter Decisions request failed with HTTP 402");
  assert.equal(call.result_json, null);
  assert.equal(call.cost_usd, null);
  assert.equal(call.served_model, null);
  assert.match(call.completed_at, isoTimestamp);
  assert.doesNotMatch(JSON.stringify(call), new RegExp(firstOpenRouterKey));
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

test("audit log ignores protocol traffic and unauthenticated tool calls", async () => {
  const client = await mcpClient();
  try {
    await client.listTools();
    await client.ping();
  } finally {
    await client.close();
  }
  const unauthenticated = await originalFetch(`${baseUrl}/jev/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(toolCall(7, "make_decisions", { state: "hello", questions: { relevant: questions.is_bug } })),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(auditLog.list().total, 0);
});

test("durably records a successful make_decisions call with its exact arguments and full result", async () => {
  const upstream = {
    id: "gen-dec-audit",
    model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    answers: { relevant: { type: "noul", noul: 0.91 } },
    usage: { input_tokens: 12, output_tokens: 3, cost: 0.000019992 },
  };
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return Response.json(upstream);
  };
  const args = { state: { ticket: "Checkout is blank", tags: ["web", "urgent"] }, questions: { relevant: questions.is_bug } };
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: args });
    assert.deepEqual(result.structuredContent, upstream);
  } finally {
    await client.close();
  }

  auditLog.close();
  const restarted = new JevAuditLog(config);
  await restarted.initialize();
  try {
    const { calls, total } = restarted.list();
    assert.equal(total, 1);
    const [call] = calls;
    assert.match(call.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(call.rpc_id, /^\d+$/);
    assert.equal(call.tool_name, "make_decisions");
    assert.equal(call.arguments_json, JSON.stringify(args));
    assert.equal(call.status, "success");
    assert.equal(call.result_json, JSON.stringify(upstream));
    assert.match(call.started_at, isoTimestamp);
    assert.match(call.completed_at, isoTimestamp);
    assert.equal(call.duration_ms, Date.parse(call.completed_at) - Date.parse(call.started_at));
    assert.ok(call.duration_ms >= 0);
  } finally {
    restarted.close();
  }
});

function upstreamMetadata(call) {
  const { requested_model, served_model, provider, generation_id, input_tokens, output_tokens, total_tokens, cost_usd } = call;
  return { requested_model, served_model, provider, generation_id, input_tokens, output_tokens, total_tokens, cost_usd };
}

test("records requested and served models, provider, generation ID, token counts, and exact cost", async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    const { model } = JSON.parse(options.body);
    return Response.json({
      id: `gen-${model}`,
      model: `${model.replace(/^~/, "")}-20260917`,
      provider: "TypeSafe",
      answers: { relevant: { type: "noul", noul: 0.5 } },
      usage: { input_tokens: 476, output_tokens: 70, total_tokens: 546, cost: 0.000019992 },
    });
  };
  const client = await mcpClient();
  try {
    await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug } } });
    await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug }, model: "~typesafe/jev-latest" } });
  } finally {
    await client.close();
  }

  const [latest, pinned] = auditLog.list().calls;
  assert.deepEqual(upstreamMetadata(pinned), {
    requested_model: "typesafe/jev-1.13",
    served_model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    generation_id: "gen-typesafe/jev-1.13",
    input_tokens: 476,
    output_tokens: 70,
    total_tokens: 546,
    cost_usd: 0.000019992,
  });
  assert.equal(latest.requested_model, "~typesafe/jev-latest");
  assert.equal(latest.served_model, "typesafe/jev-latest-20260917");
  assert.equal(latest.generation_id, "gen-~typesafe/jev-latest");
});

test("records network and timeout failures with bounded messages and no error details", async () => {
  const failures = [
    new TypeError(`fetch failed: connect ECONNREFUSED 203.0.113.9:443 using ${firstOpenRouterKey}`),
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
  ];
  let next = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    throw failures[next++];
  };
  const client = await mcpClient();
  try {
    for (const state of ["network", "timeout"]) {
      const result = await client.callTool({ name: "make_decisions", arguments: { state, questions: { relevant: questions.is_bug } } });
      assert.equal(result.isError, true);
    }
  } finally {
    await client.close();
  }
  const [timeout, network] = auditLog.list().calls;
  assert.equal(network.status, "failure");
  assert.equal(network.error_message, "OpenRouter Decisions request could not be completed");
  assert.equal(timeout.status, "failure");
  assert.equal(timeout.error_message, "OpenRouter Decisions request timed out");
  for (const call of [network, timeout]) {
    assert.equal(call.cost_usd, null);
    assert.doesNotMatch(JSON.stringify(call), /ECONNREFUSED|203\.0\.113\.9|sk-or-v1/);
  }
});

test("records unknown tools and schema-rejected arguments as failures without calling OpenRouter", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    upstreamCalls += 1;
    return Response.json({});
  };
  const unknownName = `delete_everything_${"x".repeat(2_000)}`;
  const invalid = { state: "hello", questions: { relevant: { type: "noul", instructions: "x".repeat(9_000) } }, model: "gpt-4" };
  const client = await mcpClient();
  try {
    const unknown = await client.callTool({ name: unknownName, arguments: { confirm: true } });
    assert.equal(unknown.isError, true);
    const rejected = await client.callTool({ name: "make_decisions", arguments: invalid });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /Input validation error/);
  } finally {
    await client.close();
  }

  assert.equal(upstreamCalls, 0);
  const [schemaRejected, unknownTool] = auditLog.list().calls;
  assert.equal(unknownTool.tool_name, unknownName);
  assert.equal(unknownTool.arguments_json, JSON.stringify({ confirm: true }));
  assert.equal(unknownTool.status, "failure");
  assert.match(unknownTool.error_message, /^MCP error -32602: Tool delete_everything_x+/);
  assert.ok(unknownTool.error_message.length <= 1_000);
  assert.match(unknownTool.completed_at, isoTimestamp);
  assert.equal(schemaRejected.tool_name, "make_decisions");
  assert.equal(schemaRejected.arguments_json, JSON.stringify(invalid));
  assert.equal(schemaRejected.requested_model, "gpt-4");
  assert.equal(schemaRejected.status, "failure");
  assert.match(schemaRejected.error_message, /^MCP error -32602: Input validation error: Invalid arguments for tool make_decisions/);
  assert.equal(schemaRejected.cost_usd, null);
});

test("records each tools/call item in a JSON-RPC batch separately", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    upstreamCalls += 1;
    return Response.json({ model: "typesafe/jev-1.13-20260917", answers: { relevant: { type: "noul", noul: 0.4 } } });
  };
  const overlongId = "r".repeat(300);
  const response = await postJsonRpc([
    toolCall(1, "make_decisions", { state: "first", questions: { relevant: questions.is_bug } }),
    { jsonrpc: "2.0", id: 2, method: "ping" },
    toolCall("third", "bogus_tool", {}),
    toolCall(overlongId, "make_decisions", { state: 5 }),
  ]);
  assert.equal(response.status, 200);
  assert.equal(((await response.text()).match(/^event: message$/gm) || []).length, 4);
  assert.equal(upstreamCalls, 1);

  const { calls, total } = auditLog.list();
  assert.equal(total, 3);
  assert.deepEqual(calls.map(({ rpc_id, tool_name, status }) => ({ rpc_id, tool_name, status })), [
    { rpc_id: null, tool_name: "make_decisions", status: "failure" },
    { rpc_id: '"third"', tool_name: "bogus_tool", status: "failure" },
    { rpc_id: "1", tool_name: "make_decisions", status: "success" },
  ]);
  assert.equal(calls[0].arguments_json, JSON.stringify({ state: 5 }));
  assert.match(calls[1].error_message, /Tool bogus_tool not found/);
});

test("records a tool call that the MCP transport rejects before it runs", async () => {
  const response = await postJsonRpc(
    toolCall(5, "make_decisions", { state: "hello", questions: { relevant: questions.is_bug } }),
    { accept: "application/json" },
  );
  assert.equal(response.status, 406);
  const [call] = auditLog.list().calls;
  assert.equal(call.rpc_id, "5");
  assert.equal(call.status, "failure");
  assert.equal(call.error_message, "The MCP request ended with HTTP 406 before the tool ran.");
  assert.match(call.completed_at, isoTimestamp);
});

test("fails tool calls closed when their JSON-RPC ID is reused in the same request", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    upstreamCalls += 1;
    return Response.json({ model: "typesafe/jev-1.13-20260917", answers: { relevant: { type: "noul", noul: 0.4 } } });
  };
  const response = await postJsonRpc([
    toolCall(1, "make_decisions", { state: "first", questions: { relevant: questions.is_bug } }),
    toolCall(1, "make_decisions", { state: "second", questions: { relevant: questions.is_bug } }),
    { jsonrpc: "2.0", id: "shared", method: "ping" },
    toolCall("shared", "make_decisions", { state: "third", questions: { relevant: questions.is_bug } }),
  ]);
  await response.text();
  assert.equal(upstreamCalls, 0);
  const { calls, total } = auditLog.list();
  assert.equal(total, 3);
  for (const call of calls) {
    assert.equal(call.status, "failure");
    assert.equal(call.error_message, "Another message in the same request reused this JSON-RPC ID, so the call was not run.");
  }
});

test("finalizes a call once when its client disconnects before the decision returns", async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    markStarted();
    await released;
    return Response.json({ id: "gen-late", model: "typesafe/jev-1.13-20260917", answers: { relevant: { type: "noul", noul: 0.8 } }, usage: { cost: 0.00001 } });
  };
  const controller = new AbortController();
  const request = postJsonRpc(toolCall(8, "make_decisions", { state: "hello", questions: { relevant: questions.is_bug } }), {}, controller.signal)
    .then((response) => response.body?.cancel())
    .catch(() => {});
  await started;
  controller.abort();
  await request;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(auditLog.list().calls[0].status, "pending");

  release();
  const call = await eventually(() => auditLog.list().calls.find((item) => item.status !== "pending"));
  assert.equal(call.status, "success");
  assert.equal(call.generation_id, "gen-late");
  assert.equal(call.cost_usd, 0.00001);
});

test("marks calls left pending by a stopped service as failures on the next startup", async () => {
  auditLog.receive(toolCall(3, "make_decisions", { state: "hello", questions: { relevant: questions.is_bug } }));
  assert.equal(auditLog.list().calls[0].status, "pending");
  auditLog.close();

  const restarted = new JevAuditLog(config);
  await restarted.initialize();
  try {
    const [call] = restarted.list().calls;
    assert.equal(call.status, "failure");
    assert.equal(call.error_message, "The service stopped before this call's outcome was recorded.");
    assert.equal(call.completed_at, null);
    assert.equal(call.duration_ms, null);
    assert.equal(call.cost_usd, null);
  } finally {
    restarted.close();
  }
});

test("does not call OpenRouter when the audit record cannot be written", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    upstreamCalls += 1;
    return Response.json({});
  };
  auditLog.db.exec("CREATE TRIGGER reject_audit_insert BEFORE INSERT ON tool_calls BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not sent to OpenRouter/);
    assert.doesNotMatch(result.content[0].text, /disk full/);
  } finally {
    await client.close();
  }
  assert.equal(upstreamCalls, 0);
  assert.equal(auditLog.list().total, 0);
});

test("still returns a completed decision when its audit record cannot be finalized", async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return Response.json({ model: "typesafe/jev-1.13-20260917", answers: { relevant: { type: "noul", noul: 0.7 } } });
  };
  auditLog.db.exec("CREATE TRIGGER reject_audit_update BEFORE UPDATE ON tool_calls BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug } } });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.answers.relevant.noul, 0.7);
  } finally {
    await client.close();
  }
  assert.equal(auditLog.list().calls[0].status, "pending");
});

test("records a decision that fails the MCP output schema as a failure", async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return Response.json({ answers: { relevant: { type: "noul", noul: 0.6 } }, usage: { input_tokens: 9, output_tokens: 1, cost: 0.00002 } });
  };
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { relevant: questions.is_bug } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Output validation error/);
  } finally {
    await client.close();
  }
  const [call] = auditLog.list().calls;
  assert.equal(call.status, "failure");
  assert.equal(call.error_message, "OpenRouter Decisions returned an invalid response");
  assert.equal(call.result_json, null);
  assert.equal(call.cost_usd, 0.00002);
  assert.equal(call.input_tokens, 9);
});

test("keeps validated usage metadata from an upstream response that fails decision validation", async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return Response.json({
      id: "gen-undeclared",
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      answers: { team: { type: "choice", choice: "undeclared", probabilities: { undeclared: 1 } } },
      usage: { input_tokens: 40, output_tokens: 2, cost: 0.0000031 },
    });
  };
  const client = await mcpClient();
  try {
    const result = await client.callTool({ name: "make_decisions", arguments: { state: "hello", questions: { team: questions.team } } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "OpenRouter Decisions returned an invalid response");
  } finally {
    await client.close();
  }
  const [call] = auditLog.list().calls;
  assert.equal(call.status, "failure");
  assert.equal(call.error_message, "OpenRouter Decisions returned an invalid response");
  assert.equal(call.result_json, null);
  assert.deepEqual(upstreamMetadata(call), {
    requested_model: "typesafe/jev-1.13",
    served_model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    generation_id: "gen-undeclared",
    input_tokens: 40,
    output_tokens: 2,
    total_tokens: null,
    cost_usd: 0.0000031,
  });
});

test("records missing or invalid usage values as unavailable instead of zero", async () => {
  const usages = [
    undefined,
    { input_tokens: -3, output_tokens: 2.5, total_tokens: "12", cost: -0.01 },
    { cost: "0.001" },
  ];
  let next = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    const usage = usages[next++];
    return Response.json({
      id: "gen-usage",
      model: "typesafe/jev-1.13-20260917",
      provider: "p".repeat(300),
      answers: { relevant: { type: "noul", noul: 0.3 } },
      ...(usage ? { usage } : {}),
    });
  };
  const client = await mcpClient();
  try {
    for (let index = 0; index < usages.length; index += 1) {
      const result = await client.callTool({ name: "make_decisions", arguments: { state: `case ${index}`, questions: { relevant: questions.is_bug } } });
      assert.notEqual(result.isError, true);
    }
  } finally {
    await client.close();
  }
  const { calls } = auditLog.list();
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.status, "success");
    assert.deepEqual(upstreamMetadata(call), {
      requested_model: "typesafe/jev-1.13",
      served_model: "typesafe/jev-1.13-20260917",
      provider: null,
      generation_id: "gen-usage",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      cost_usd: null,
    });
  }
});

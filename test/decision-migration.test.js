import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";

test("decision maker exposes both models under a generic MCP name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "decision-migration-"));
  await mkdir(path.join(root, "secrets"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  const openRouterApiKeyFile = path.join(root, "secrets", "openrouter-api-key");
  const secret = "m".repeat(64);
  await writeFile(secretFile, secret);
  await writeFile(openRouterApiKeyFile, "test-provider-key");
  const created = await createApp({ secretFile, openRouterApiKeyFile, dataDir: path.join(root, "data"), publicBaseUrl: "https://example.test", maxHtmlBytes: 1024, maxListItems: 200, allowedHosts: ["127.0.0.1"] });
  const server = createServer(created.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "migration-test", version: "1" });
  try {
    const retired = await fetch(`${base}/jev/mcp`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(retired.status, 404);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.ok(health.modules.includes("decisions"));
    assert.ok(!health.modules.includes("jev"));
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/decisions/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), ["make_decisions"]);
    assert.deepEqual(tools[0].inputSchema.properties.model.enum, ["cloudflare/clef-flash", "typesafe/jev-1.13"]);
    assert.equal(tools[0].inputSchema.properties.model.default, undefined);
    const result = await client.callTool({ name: "make_decisions", arguments: { model: "unsupported/model", state: "hello", questions: { ok: { type: "noul", instructions: "Is this a greeting?" } } } });
    assert.equal(result.isError, true);
    const page = await (await fetch(`${base}/decisions/README.md`)).text();
    assert.match(page, /aravind_decision_maker/);
    assert.match(page, /cloudflare\/clef-flash/);
    assert.match(page, /typesafe\/jev-1.13/);
    const logs = await fetch(`${base}/decisions/logs`, { redirect: "manual" });
    assert.equal(logs.status, 307);
    assert.equal(logs.headers.get("location"), "/artifacts/decisions/logs");
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    created.decisionsAuditLog.close();
    created.questionnaireStore.close();
    await rm(root, { recursive: true, force: true });
  }
});

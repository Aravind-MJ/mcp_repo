import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";

const logPath = "/artifacts/decisions/logs";
const trusted = { "x-artifact-basic-auth": "1" };

test("protected dashboard switches the persistent default while MCP allows explicit overrides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "decision-settings-"));
  await mkdir(path.join(root, "secrets"));
  const config = { dataDir: path.join(root, "data"), secretFile: path.join(root, "secrets", "shared-secret"), openRouterApiKeyFile: path.join(root, "secrets", "openrouter-api-key"), publicBaseUrl: "https://example.test", maxHtmlBytes: 1024, maxListItems: 200, allowedHosts: ["127.0.0.1"] };
  const secret = "m".repeat(64);
  await writeFile(config.secretFile, secret);
  await writeFile(config.openRouterApiKeyFile, "test-upstream-key");
  const created = await createApp(config);
  const server = createServer(created.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const networkFetch = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return networkFetch(url, options);
    const { model, questions } = JSON.parse(options.body);
    observed.push(model);
    return Response.json({ model: model === "typesafe/jev-1.13" ? `${model}-20260917` : model, provider: model.startsWith("cloudflare/") ? "Cloudflare" : "TypeSafe", answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: "noul", noul: 0.9 }])) });
  };
  const client = new Client({ name: "switch-test", version: "1" });
  try {
    assert.equal((await fetch(`${base}${logPath}`)).status, 404);
    const dashboard = await fetch(`${base}${logPath}`, { headers: trusted });
    assert.equal(dashboard.headers.get("referrer-policy"), "same-origin", "Form submissions must retain their same-origin Origin header");
    const page = await dashboard.text();
    assert.match(page, /<select[^>]*name="model"/);
    assert.match(page, /value="cloudflare\/clef-flash" selected/);
    assert.match(page, /value="typesafe\/jev-1.13"/);
    const csrf = page.match(/name="csrf_token" value="([^"]+)"/)?.[1];
    assert.ok(csrf);
    const post = (body, headers = trusted) => fetch(`${base}${logPath}/model`, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), redirect: "manual" });
    assert.equal((await post({ model: "typesafe/jev-1.13", csrf_token: csrf }, {})).status, 404);
    assert.equal((await post({ model: "typesafe/jev-1.13" })).status, 403);
    assert.equal((await post({ model: "other/model", csrf_token: csrf })).status, 400);
    assert.equal((await post({ model: "typesafe/jev-1.13", csrf_token: csrf }, { ...trusted, Origin: "https://attacker.test" })).status, 403);
    assert.equal((await post({ model: "typesafe/jev-1.13", csrf_token: csrf }, { ...trusted, Origin: "null" })).status, 403);
    const switched = await post({ model: "typesafe/jev-1.13", csrf_token: csrf }, { ...trusted, Origin: config.publicBaseUrl });
    assert.equal(switched.status, 303);
    assert.equal(switched.headers.get("location"), logPath);
    assert.equal(await created.decisionSettings.getModel(), "typesafe/jev-1.13");
    const settingsFile = path.join(config.dataDir, "decisions", "settings.json");
    assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), { model: "typesafe/jev-1.13" });
    assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);
    const reloaded = new created.decisionSettings.constructor(config);
    assert.equal(await reloaded.getModel(), "typesafe/jev-1.13");
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/decisions/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
    const args = { state: "Hello", questions: { greeting: { type: "noul", instructions: "Is this a greeting?" } } };
    await client.callTool({ name: "make_decisions", arguments: args });
    await client.callTool({ name: "make_decisions", arguments: { ...args, model: "cloudflare/clef-flash" } });
    const invalid = await client.callTool({ name: "make_decisions", arguments: { ...args, model: "other/model" } });
    assert.equal(invalid.isError, true);
    assert.deepEqual(observed, ["typesafe/jev-1.13", "cloudflare/clef-flash"]);
    const successful = created.decisionsAuditLog.list().calls.filter(c => c.status === "success");
    assert.deepEqual(successful.map(c => c.requested_model), ["cloudflare/clef-flash", "typesafe/jev-1.13"]);
    const switchedPage = await (await fetch(`${base}${logPath}`, { headers: trusted })).text();
    assert.match(switchedPage, /value="typesafe\/jev-1.13" selected/);
  } finally {
    globalThis.fetch = networkFetch;
    await client.close();
    await new Promise(resolve => server.close(resolve));
    created.decisionsAuditLog.close();
    created.questionnaireStore.close();
    await rm(root, { recursive: true, force: true });
  }
});

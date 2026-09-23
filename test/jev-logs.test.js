import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";

let root;
let server;
let baseUrl;
let auditLog;
let originalFetch;
const sharedSecret = "s".repeat(64);
const openRouterKey = "sk-or-v1-log-page-test-key";
const trustedHeaders = { "x-jev-basic-auth": "1" };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "jev-logs-test-"));
  const secretDirectory = path.join(root, "secrets");
  await mkdir(secretDirectory, { recursive: true });
  await writeFile(path.join(secretDirectory, "shared-secret"), sharedSecret, { mode: 0o600 });
  await writeFile(path.join(secretDirectory, "openrouter-api-key"), openRouterKey, { mode: 0o600 });
  const created = await createApp({
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(root, "data"),
    secretFile: path.join(secretDirectory, "shared-secret"),
    openRouterApiKeyFile: path.join(secretDirectory, "openrouter-api-key"),
    publicBaseUrl: "https://mcp.example.test",
    maxHtmlBytes: 1024,
    maxListItems: 200,
    maxQuestionnaires: 500,
    maxQuestions: 200,
    maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  });
  auditLog = created.jevAuditLog;
  originalFetch = globalThis.fetch;
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

const relevant = {
  type: "noul",
  instructions: "Is the customer reporting a software defect?",
  criteria: { true: "Broken or unexpected product behavior.", false: "A question or feature request." },
};

function mockOpenRouter(respond) {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, options);
    return respond(JSON.parse(options.body), options);
  };
}

async function callTool(name, args) {
  const client = new Client({ name: "jev-log-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/jev/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

function utc(timestamp) {
  return `${timestamp.slice(0, 19).replace("T", " ")} UTC`;
}

test("conceals the Jev call log unless Caddy marks Basic Auth as trusted", async () => {
  for (const pathname of ["/jev/logs", "/jev/logs/"]) {
    for (const headers of [{}, { "x-jev-basic-auth": "true" }, { "x-questionnaire-basic-auth": "1" }]) {
      const hidden = await fetch(`${baseUrl}${pathname}`, { headers });
      assert.equal(hidden.status, 404);
      assert.equal(hidden.headers.get("cache-control"), "private, no-store");
      assert.match(hidden.headers.get("x-robots-tag"), /noindex/);
      assert.equal(await hidden.text(), "Not found");
    }

    const shown = await fetch(`${baseUrl}${pathname}`, { headers: trustedHeaders });
    assert.equal(shown.status, 200);
    assert.match(shown.headers.get("content-type"), /^text\/html/);
    assert.equal(shown.headers.get("cache-control"), "private, no-store");
    assert.match(shown.headers.get("x-robots-tag"), /noindex/);
    assert.equal(shown.headers.get("x-frame-options"), "DENY");
    assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
    assert.equal(shown.headers.get("referrer-policy"), "no-referrer");
    const csp = shown.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|script-src/);
    const nonce = csp.match(/style-src 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    assert.ok(nonce);
    assert.ok((await shown.text()).includes(`<style nonce="${nonce}">`));
  }
  assert.equal((await fetch(`${baseUrl}/jev/logs/anything`)).status, 404);
});

async function logPage(query = "") {
  const response = await fetch(`${baseUrl}/jev/logs${query}`, { headers: trustedHeaders });
  assert.equal(response.status, 200);
  return response.text();
}

test("explains an empty log without reporting a zero cost", async () => {
  const html = await logPage();
  assert.match(html, /<h1>Jev calls<\/h1>/);
  assert.match(html, /<a href="\/jev">[^<]*Jev overview<\/a>/);
  assert.match(html, /<dt>Total calls<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Succeeded<\/dt><dd>0<\/dd>/);
  assert.match(html, /<div><dt>Failed<\/dt><dd>0<\/dd><\/div>/);
  assert.match(html, /<dt>Total cost<\/dt><dd>Cost unavailable<\/dd>/);
  assert.doesNotMatch(html, /\$0\b/);
  assert.match(html, /<h2>No Jev tool calls recorded yet<\/h2>/);
});

test("shows a successful call with its metadata, exact tiny cost, and expandable details", async () => {
  mockOpenRouter(() => Response.json({
    id: "gen-tiny",
    model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    answers: { relevant: { type: "noul", noul: 0.93 } },
    usage: { input_tokens: 1234, output_tokens: 5, total_tokens: 1239, cost: 1.2e-8 },
  }));
  const result = await callTool("make_decisions", { state: "Checkout is blank", questions: { relevant } });
  assert.notEqual(result.isError, true);
  const [call] = auditLog.list().calls;

  const html = await logPage();
  assert.match(html, /<article class="call call--success"/);
  assert.match(html, /<span class="badge badge--success"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Succeeded<\/span>/);
  assert.match(html, /<code>make_decisions<\/code>/);
  assert.ok(html.includes(`<dt>Started</dt><dd><time datetime="${call.started_at}">${utc(call.started_at)}</time></dd>`));
  assert.ok(html.includes(`<dt>Completed</dt><dd><time datetime="${call.completed_at}">${utc(call.completed_at)}</time></dd>`));
  assert.match(html, /<dt>Duration<\/dt><dd>(?:\d+ ms|\d+\.\d s)<\/dd>/);
  assert.match(html, /<dt>Requested model<\/dt><dd>typesafe\/jev-1\.13<\/dd>/);
  assert.match(html, /<dt>Served model<\/dt><dd>typesafe\/jev-1\.13-20260917<\/dd>/);
  assert.match(html, /<dt>Provider<\/dt><dd>TypeSafe<\/dd>/);
  assert.match(html, /<dt>Tokens<\/dt><dd>1,234 in · 5 out · 1,239 total<\/dd>/);
  assert.match(html, /<dt>Cost<\/dt><dd>\$0\.000000012<\/dd>/);
  assert.ok(html.includes(`<dt>Call ID</dt><dd><code>${call.id}</code></dd>`));
  assert.ok(html.includes(`<dt>JSON-RPC ID</dt><dd><code>${call.rpc_id}</code></dd>`));
  assert.match(html, /<dt>Generation ID<\/dt><dd><code>gen-tiny<\/code><\/dd>/);
  assert.match(html, /<details><summary>Request arguments<\/summary><pre><code>\{\n {2}&quot;state&quot;: &quot;Checkout is blank&quot;,/);
  assert.match(html, /<details><summary>Result<\/summary><pre><code>\{\n {2}&quot;id&quot;: &quot;gen-tiny&quot;,/);
  assert.match(html, /&quot;cost&quot;: 1\.2e-8/);
  assert.match(html, /<dt>Total calls<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>Succeeded<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>Total cost<\/dt><dd>\$0\.000000012<\/dd>/);
  assert.doesNotMatch(html, /No Jev tool calls recorded yet|\$0\.00<|1\.2e-8<\/dd>/);
});

function stylesheet(html) {
  return html.match(/<style nonce="[^"]+">([\s\S]*?)<\/style>/)[1];
}

test("highlights a failed upstream call with an icon, text, and failure styling", async () => {
  mockOpenRouter((request, options) => Response.json(
    { error: { message: `Insufficient credits for ${options.headers.Authorization}` } },
    { status: 402 },
  ));
  const result = await callTool("make_decisions", { state: "hello", questions: { relevant } });
  assert.equal(result.isError, true);

  const html = await logPage();
  assert.match(html, /<article class="call call--failure"/);
  assert.match(html, /<span class="badge badge--failure"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Failed<\/span>/);
  assert.match(html, /<p class="failure-reason"><strong>Failure reason<\/strong>OpenRouter Decisions request failed with HTTP 402<\/p>/);
  assert.match(html, /<dt>Cost<\/dt><dd>Cost unavailable<\/dd>/);
  assert.match(html, /<dt>Served model<\/dt><dd>Not reported<\/dd>/);
  assert.match(html, /<div class="summary-failed"><dt>Failed<\/dt><dd>1<\/dd><\/div>/);
  assert.match(html, /<dt>Total cost<\/dt><dd>Cost unavailable<\/dd>/);
  assert.match(html, /<details><summary>Request arguments<\/summary>/);
  assert.doesNotMatch(html, /<summary>Result<\/summary>/);
  assert.doesNotMatch(html, new RegExp(openRouterKey));

  const css = stylesheet(html);
  assert.match(css, /\.call--failure\{[^}]*border-color:var\(--danger\)[^}]*background:[^}]*\}/);
  assert.match(css, /\.badge--failure\{[^}]*background:var\(--danger-soft\)[^}]*color:var\(--danger\)[^}]*\}/);
  assert.match(css, /\.failure-reason\{[^}]*border-left:[^}]*\}/);
});

test("renders logged markup inertly and never exposes credentials", async () => {
  mockOpenRouter((request, options) => request.state.startsWith("fail")
    ? Response.json({ error: { message: `Rejected ${options.headers.Authorization}` } }, { status: 401 })
    : Response.json({
      id: "gen-<b>bold</b>",
      model: "typesafe/jev-1.13-20260917",
      provider: '<img src=x onerror="alert(1)">',
      answers: { relevant: { type: "noul", noul: 0.5 } },
      usage: { cost: 0.0001 },
    }));
  await callTool("make_decisions", { state: "</code></pre><script>alert('state')</script>", questions: { relevant } });
  await callTool("make_decisions", { state: "fail upstream", questions: { relevant } });
  await callTool('<svg onload="alert(1)">', { note: "</details><script>alert(2)</script>" });

  const html = await logPage();
  assert.doesNotMatch(html, /<script|<img src=x|<svg onload|<b>bold<\/b>/i);
  assert.match(html, /&lt;\/code&gt;&lt;\/pre&gt;&lt;script&gt;alert\(&#39;state&#39;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;\/details&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(html, /<h2 id="call-[^"]+"><code>&lt;svg onload=&quot;alert\(1\)&quot;&gt;<\/code><\/h2>/);
  assert.match(html, /<dt>Provider<\/dt><dd>&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<\/dd>/);
  assert.match(html, /<dt>Generation ID<\/dt><dd><code>gen-&lt;b&gt;bold&lt;\/b&gt;<\/code><\/dd>/);
  assert.match(html, /OpenRouter Decisions request failed with HTTP 401/);

  const stored = await Promise.all(["audit.sqlite3", "audit.sqlite3-wal"].map((file) => readFile(path.join(root, "data", "jev", file)).catch(() => Buffer.alloc(0))));
  for (const content of [html, ...stored.map((buffer) => buffer.toString("latin1"))]) {
    assert.ok(!content.includes(openRouterKey));
    assert.ok(!content.includes(sharedSecret));
  }
});

function recordSuccessfulCalls(count) {
  const messages = Array.from({ length: count }, (_, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "tools/call",
    params: { name: "make_decisions", arguments: { state: `call ${index + 1}`, questions: { relevant } } },
  }));
  const calls = auditLog.receive(messages);
  for (const message of messages) {
    calls.claim(message.id).succeed({ model: "typesafe/jev-1.13-20260917", answers: { relevant: { type: "noul", noul: 0.5 } } });
  }
}

function listedRequestIds(html) {
  return [...html.matchAll(/<dt>JSON-RPC ID<\/dt><dd><code>(\d+)<\/code>/g)].map((match) => Number(match[1]));
}

test("pages through calls newest first with a bounded page size", async () => {
  recordSuccessfulCalls(27);

  const first = await logPage();
  assert.deepEqual(listedRequestIds(first), Array.from({ length: 25 }, (_, index) => 27 - index));
  assert.match(first, /Calls 1 to 25 of 27/);
  assert.match(first, /<a class="button" rel="next" href="\/jev\/logs\?offset=25">Older calls<\/a>/);
  assert.doesNotMatch(first, /rel="prev"/);

  const second = await logPage("?offset=25");
  assert.deepEqual(listedRequestIds(second), [2, 1]);
  assert.match(second, /Calls 26 to 27 of 27/);
  assert.match(second, /<a class="button" rel="prev" href="\/jev\/logs\?offset=0">Newer calls<\/a>/);
  assert.doesNotMatch(second, /rel="next"/);
  assert.match(second, /<dt>Total calls<\/dt><dd>27<\/dd>/);

  for (const query of ["?offset=-5", "?offset=abc", "?offset=1e3", "?offset=25&offset=0"]) {
    assert.equal(listedRequestIds(await logPage(query))[0], 27);
  }

  const beyond = await logPage("?offset=500");
  assert.deepEqual(listedRequestIds(beyond), []);
  assert.match(beyond, /<h2>No calls on this page<\/h2>/);
  assert.match(beyond, /<a class="button" href="\/jev\/logs">Show the newest calls<\/a>/);
});

test("adds costs as exact decimals and says how many calls lack cost data", async () => {
  const costs = [0.1, 0.2, 1.2e-8, undefined];
  const messages = [...costs, "failure"].map((_, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "tools/call",
    params: { name: "make_decisions", arguments: { state: `call ${index + 1}`, questions: { relevant } } },
  }));
  const calls = auditLog.receive(messages);
  costs.forEach((cost, index) => calls.claim(index + 1).succeed({
    model: "typesafe/jev-1.13-20260917",
    answers: { relevant: { type: "noul", noul: 0.5 } },
    ...(cost === undefined ? {} : { usage: { cost } }),
  }));
  calls.claim(5).fail(new Error("OpenRouter Decisions request timed out"));

  const html = await logPage();
  assert.match(html, /<dt>Total calls<\/dt><dd>5<\/dd>/);
  assert.match(html, /<dt>Succeeded<\/dt><dd>4<\/dd>/);
  assert.match(html, /<dt>Failed<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>Total cost<\/dt><dd>\$0\.300000012<\/dd>/);
  assert.match(html, /2 calls have no cost data, so the total covers 3 calls\./);
  assert.match(html, /<dt>Cost<\/dt><dd>\$0\.1<\/dd>/);
  assert.match(html, /<dt>Cost<\/dt><dd>\$0\.2<\/dd>/);
  assert.match(html, /<dt>Cost<\/dt><dd>\$0\.000000012<\/dd>/);
});

test("marks unfinished calls and flags stale ones for review like failures", async () => {
  auditLog.receive([1, 2].map((id) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "make_decisions", arguments: { state: `call ${id}`, questions: { relevant } } },
  })));
  auditLog.db.prepare("UPDATE tool_calls SET started_at = ? WHERE rpc_id = '1'").run(new Date(Date.now() - 10 * 60_000).toISOString());

  const html = await logPage();
  assert.match(html, /<article class="call call--pending"[^>]*><div class="call-head"><span class="badge badge--pending"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>In progress<\/span>/);
  assert.match(html, /<article class="call call--stale"[^>]*><div class="call-head"><span class="badge badge--stale"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>No outcome recorded<\/span>/);
  assert.match(html, /<p class="failure-reason"><strong>Needs review<\/strong>No outcome was recorded within 90 seconds of the start\. The call may have been interrupted, or its result could not be saved\.<\/p>/);
  assert.equal((html.match(/class="failure-reason"/g) || []).length, 1);
  assert.match(html, /<dt>Unfinished<\/dt><dd>2<\/dd>/);
  assert.match(html, /<dt>Completed<\/dt><dd>Not recorded<\/dd>/);
  assert.match(html, /<dt>Cost<\/dt><dd>Cost unavailable<\/dd>/);

  const css = stylesheet(html);
  assert.match(css, /\.call--stale\{[^}]*border-color:var\(--danger\)[^}]*\}/);
  assert.match(css, /\.badge--stale\{[^}]*color:var\(--danger\)[^}]*\}/);
  assert.match(css, /\.badge--pending\{[^}]*color:var\(--warning\)[^}]*\}/);
});

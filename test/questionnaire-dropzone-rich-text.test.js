import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Script } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import {
  RICH_TEXT_FORMAT,
  RICH_TEXT_LIMITS,
  normalizeRichText,
  renderRichTextHtml,
  richTextPlainText,
} from "../src/questionnaire/rich-text.js";

const sharedSecret = "s".repeat(64);
const trustedHeaders = { "x-questionnaire-basic-auth": "1" };
let root;
let server;
let baseUrl;
let config;
let store;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-dropzone-rich-text-test-"));
  const secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, sharedSecret, { mode: 0o600 });
  config = {
    host: "127.0.0.1", port: 0, dataDir: path.join(root, ".runtime", "data"), secretFile,
    publicBaseUrl: "https://mcp.example.test", maxHtmlBytes: 1024, maxListItems: 200,
    maxQuestionnaires: 500, maxQuestions: 200, maxAnswerBytes: 256 * 1024,
    allowedHosts: ["127.0.0.1", "localhost"],
  };
  const created = await createApp(config);
  store = created.questionnaireStore;
  server = createServer(created.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  store?.close();
  await rm(root, { recursive: true, force: true });
});

function localUrl(publicUrl) {
  return publicUrl.replace(config.publicBaseUrl, baseUrl);
}

function subresourceUrl(signedUrl, suffix) {
  const source = new URL(localUrl(signedUrl));
  const target = new URL(`${source.pathname}${suffix}`, baseUrl);
  target.search = source.search;
  return target.toString();
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

async function browserDraft(questionnaire) {
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, questionnaire.revision);
  const created = await json(await fetch(subresourceUrl(signed.url, "/responses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(created.status, 201);
  const { response_id: responseId, edit_token: editToken } = created.body;
  const headers = { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": editToken };
  return {
    responseId,
    save: async (answers) => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}`), { method: "PATCH", headers, body: JSON.stringify({ answers }) })),
    load: async () => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}`), { headers })),
    submit: async (answers) => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}/submit`), { method: "POST", headers, body: JSON.stringify({ answers }) })),
  };
}

async function answerPage(questionnaire) {
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, questionnaire.revision);
  const response = await fetch(localUrl(signed.url));
  assert.equal(response.status, 200);
  return { response, html: await response.text() };
}

const doc = (...ops) => ({ format: RICH_TEXT_FORMAT, ops });

const richQuestions = [
  { id: "story", type: "long_text", title: "Story", required: true, settings: { rich_text: true }, validation: { min_length: 3, max_length: 40 } },
  { id: "plain", type: "long_text", title: "Plain notes" },
  {
    id: "rooms",
    type: "repeatable_rows",
    title: "Rooms",
    fields: [
      { id: "notes", type: "long_text", title: "Notes", required: true, settings: { rich_text: true } },
      { id: "photo", type: "file_upload", title: "Photo", settings: { max_files: 2 } },
    ],
  },
];

// Dropzones

test("upload fields render a labelled dropzone around a focusable native file input, including row templates", async () => {
  const questionnaire = store.create({ title: "Inventory", questions: [{ id: "receipt", type: "file_upload", title: "Receipt", required: true }, richQuestions[2]] });
  const { html } = await answerPage(questionnaire);
  assert.match(html, /<label class="upload-dropzone" for="q-receipt" data-dropzone>[\s\S]*?<input class="upload-input" type="file" id="q-receipt"/);
  assert.match(html, /<label class="upload-dropzone" for="q-rooms__ROWID__photo" data-dropzone>/);
  assert.match(html, /Drag images here or <span class="upload-browse">browse<\/span>/);
  // The input stays in the tab order: never display:none, the hidden attribute, or tabindex=-1.
  const input = /<input class="upload-input"[^>]*>/.exec(html)[0];
  assert.doesNotMatch(input, /\bhidden\b|tabindex="-1"/);
  assert.doesNotMatch(html, /\.upload-input\s*\{[^}]*display:\s*none/);
  assert.match(html, /\.upload-input\s*\{[^}]*opacity:\s*0/);
  // One delegated set of drag listeners on the form; window-level guards stop file navigation.
  assert.match(html, /form\.addEventListener\("drop"/);
  assert.match(html, /for \(const type of \["dragover", "drop"\]\) \{\s*window\.addEventListener\(type/);
  assert.match(html, /function acceptFiles\(field, files\)/);
  for (const script of html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)) new Script(script[1]);
});

// Rich text documents

test("normalizeRichText canonicalizes allowed Delta documents", () => {
  const value = normalizeRichText(doc(
    { insert: "Hello " },
    { insert: "big", attributes: { bold: true } },
    { insert: " world", attributes: { bold: true } },
    { insert: "\r\nsee " },
    { insert: "docs", attributes: { link: "https://example.com/a?b=1", italic: true } },
    { insert: "\n" },
    { insert: "one" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "two" },
  ));
  assert.deepEqual(value, doc(
    { insert: "Hello " },
    { insert: "big world", attributes: { bold: true } },
    { insert: "\nsee " },
    { insert: "docs", attributes: { italic: true, link: "https://example.com/a?b=1" } },
    { insert: "\none" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "two\n" },
  ));
  assert.equal(richTextPlainText(value), "Hello big world\nsee docs\none\ntwo");
  // Inline formatting on a bare line break carries no meaning and is dropped.
  assert.deepEqual(normalizeRichText(doc({ insert: "a" }, { insert: "\n", attributes: { bold: true } })), doc({ insert: "a\n" }));
});

test("normalizeRichText rejects HTML-like, embedded, hostile, and oversized documents", () => {
  const rejects = (value, pattern) => assert.throws(() => normalizeRichText(value), pattern);
  rejects("<b>hi</b>", /rich text document/);
  rejects([], /rich text document/);
  rejects({ ops: [{ insert: "a\n" }] }, /format/);
  rejects({ format: "html", ops: [{ insert: "a\n" }] }, /format/);
  rejects({ ...doc({ insert: "a\n" }), html: "<p>a</p>" }, /only contain format and ops/);
  rejects(doc(), /non-empty/);
  rejects(doc({ insert: { image: "https://example.com/x.png" } }), /text inserts only/);
  rejects(doc({ retain: 3 }), /text inserts only/);
  rejects(doc({ insert: "a", delete: 1 }), /text inserts only/);
  rejects(doc({ insert: "a\u0000b\n" }), /control characters/);
  for (const format of [{ header: 1 }, { color: "#f00" }, { underline: true }, { script: "sub" }, { code: true }, { image: "x" }]) {
    rejects(doc({ insert: "a", attributes: format }, { insert: "\n" }), /unsupported rich text formatting/);
  }
  rejects(doc({ insert: "a", attributes: { bold: "yes" } }, { insert: "\n" }), /bold/);
  rejects(doc({ insert: "a" }, { insert: "\n", attributes: { list: "checked" } }), /ordered or bullet/);
  rejects(doc({ insert: "a", attributes: { list: "bullet" } }, { insert: "\n" }), /line breaks/);
  for (const link of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "/relative", "//example.com", "mailto:a@b.c", "https://user:pass@example.com/", "https://exa mple.com", " https://example.com", `https://example.com/${"a".repeat(RICH_TEXT_LIMITS.max_link_length)}`]) {
    rejects(doc({ insert: "x", attributes: { link } }, { insert: "\n" }), /links must be http or https/);
  }
  rejects(doc(...Array.from({ length: RICH_TEXT_LIMITS.max_ops + 1 }, (_, index) => ({ insert: String(index), attributes: index % 2 ? { bold: true } : undefined }))), /too many operations/);
  rejects(doc({ insert: `${"x".repeat(RICH_TEXT_LIMITS.max_bytes)}\n` }), /too large/);
});

test("renderRichTextHtml escapes text and emits only allow-listed tags and safe links", () => {
  const html = renderRichTextHtml(doc(
    { insert: "<script>alert(1)</script> & " },
    { insert: "bold", attributes: { bold: true } },
    { insert: " " },
    { insert: "it", attributes: { italic: true } },
    { insert: " " },
    { insert: "site\"><img src=x onerror=1>", attributes: { link: "https://example.com/?q=\"<x>" } },
    { insert: "\nfirst" },
    { insert: "\n", attributes: { list: "ordered" } },
    { insert: "second" },
    { insert: "\n", attributes: { list: "ordered" } },
    { insert: "dot" },
    { insert: "\n", attributes: { list: "bullet" } },
    { insert: "\nend\n" },
  ));
  assert.equal(html, [
    '<div class="rich-answer">',
    "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <strong>bold</strong> <em>it</em> ",
    '<a href="https://example.com/?q=%22%3Cx%3E" target="_blank" rel="noopener noreferrer nofollow">site&quot;&gt;&lt;img src=x onerror=1&gt;</a></p>',
    "<ol><li>first</li><li>second</li></ol><ul><li>dot</li></ul><p><br></p><p>end</p>",
    "</div>",
  ].join(""));
  // Stored data that no longer normalizes still renders as inert text, never markup.
  const hostile = renderRichTextHtml({ format: RICH_TEXT_FORMAT, ops: [{ insert: "<i>x</i>", attributes: { link: "javascript:alert(1)" } }, { insert: { video: "x" } }] });
  assert.doesNotMatch(hostile, /<a |<i>|javascript:/);
  assert.match(hostile, /&lt;i&gt;x&lt;\/i&gt;/);
});

// Definitions

test("long_text opts in to rich text with settings.rich_text; plain long_text definitions are unchanged", () => {
  const define = (question) => store.create({ title: "T", questions: [question] }).questions[0];
  assert.deepEqual(define({ id: "a", type: "long_text", title: "A", settings: { rich_text: true } }).settings, { rich_text: true });
  assert.equal(define({ id: "a", type: "long_text", title: "A" }).settings, undefined);
  assert.equal(define({ id: "a", type: "long_text", title: "A", settings: { rich_text: false } }).settings, undefined);
  assert.throws(() => define({ id: "a", type: "long_text", title: "A", settings: { rich_text: "yes" } }), /rich_text must be a boolean/);
  assert.throws(() => define({ id: "a", type: "long_text", title: "A", settings: { rich_text: true, html: true } }), /a\.settings may only contain rich_text/);
});

// Answers

test("rich answers save canonically, plain strings stay plain, and plain long_text rejects documents", async () => {
  const questionnaire = store.create({ title: "Rich", questions: richQuestions });
  const draft = await browserDraft(questionnaire);
  const story = doc({ insert: "Hi " }, { insert: "there", attributes: { bold: true } }, { insert: "\n" });
  let saved = await draft.save({ story, plain: "  <b>keep</b>\r\nme  " });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.answers.story, story);
  assert.equal(saved.body.answers.plain, "  <b>keep</b>\nme  ");
  saved = await draft.save({ story: "legacy plain answer" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await draft.load()).body.answers.story, "legacy plain answer");
  // An empty editor autosaves as no answer at all.
  saved = await draft.save({ story: doc({ insert: "​ \n" }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(Object.hasOwn(saved.body.answers, "story"), false);

  const rejected = async (answers, pattern) => {
    const result = await draft.save(answers);
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, pattern);
  };
  await rejected({ plain: story }, /^plain: answer must be text$/);
  await rejected({ story: doc({ insert: "x", attributes: { link: "javascript:alert(1)" } }, { insert: "\n" }) }, /^story: links must be http or https URLs$/);
  await rejected({ story: doc({ insert: { image: "https://example.com/a.png" } }) }, /^story: rich text supports text inserts only$/);
  await rejected({ story: doc({ insert: `${"x".repeat(41)}\n` }) }, /^story: answer must contain at most 40 characters$/);
  await rejected({ rooms: [{ row_id: "r1", values: { notes: doc({ insert: "x", attributes: { header: 1 } }, { insert: "\n" }) } }] }, /^rooms\[1\]\.notes: unsupported rich text formatting$/);
});

test("required rich answers need meaningful text and length checks count visible text", async () => {
  const questionnaire = store.create({ title: "Rich", questions: richQuestions });
  const draft = await browserDraft(questionnaire);
  const failsWith = async (answers, pattern) => {
    const result = await draft.submit(answers);
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, pattern);
  };
  await failsWith({ story: doc({ insert: "\n" }) }, /^story: an answer is required$/);
  await failsWith({ story: doc({ insert: " ​⁠﻿ \n", attributes: undefined }, { insert: "\n", attributes: { list: "bullet" } }) }, /^story: an answer is required$/);
  await failsWith({ story: doc({ insert: "ab", attributes: { bold: true } }, { insert: "\n" }) }, /^story: answer must contain at least 3 characters$/);
  await failsWith({ story: doc({ insert: "Good\n" }), rooms: [{ row_id: "r1", values: { notes: doc({ insert: "​\n" }) } }] }, /^rooms\[1\]\.notes: an answer is required$/);
  const story = doc({ insert: "Good", attributes: { italic: true } }, { insert: "\n" });
  const notes = doc({ insert: "Tidy" }, { insert: "\n", attributes: { list: "ordered" } });
  const submitted = await draft.submit({ story, rooms: [{ row_id: "r1", values: { notes } }] });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.deepEqual(submitted.body.answers.story, story);
  assert.deepEqual(submitted.body.answers.rooms[0].values.notes, notes);
});

// Answer page and local editor asset

test("rich questions load the locally served pinned editor bundle under the nonce CSP; other pages do not", async () => {
  const plainOnly = store.create({ title: "Plain", questions: [{ id: "plain", type: "long_text", title: "Plain" }] });
  const plainPage = await answerPage(plainOnly);
  assert.doesNotMatch(plainPage.html, /<script[^>]*src=|data-rich-text=/);
  assert.match(plainPage.html, /<textarea class="text-control" name="plain"/);

  const questionnaire = store.create({ title: "Rich", questions: richQuestions });
  const { response, html } = await answerPage(questionnaire);
  const csp = response.headers.get("content-security-policy");
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.match(html, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, "\\$&")}" src="/questionnaire/assets/quill-2\\.0\\.3\\.js"></script>`));
  assert.doesNotMatch(html, /cdn|unpkg|jsdelivr/i);
  assert.match(html, /<div class="rich-text" data-rich-text="story" data-required="true" data-min-length="3" data-max-length="40">/);
  assert.match(html, /<div class="rich-text" data-rich-text="rooms__ROWID__notes" data-required="true">/);
  assert.match(html, /<div class="rich-toolbar" role="toolbar" aria-label="Formatting for Story" aria-controls="q-story">/);
  for (const format of ["bold", "italic", "ordered", "bullet", "link"]) assert.match(html, new RegExp(`data-rich-format="${format}"`));
  assert.doesNotMatch(html, /data-rich-format="(header|color|image|video|underline)"/);
  assert.match(html, /<div class="rich-editor" id="q-story" data-rich-editor aria-labelledby="question-title-story" aria-describedby="question-error-story" aria-required="true"><\/div>/);
  assert.match(html, /<textarea class="text-control" name="plain"/);
  for (const script of html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)) new Script(script[1]);

  const asset = await fetch(`${baseUrl}/questionnaire/assets/quill-2.0.3.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /^text\/javascript/);
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  assert.match(asset.headers.get("cache-control"), /immutable/);
  assert.equal(asset.headers.get("cross-origin-resource-policy"), "same-origin");
  const body = await asset.text();
  assert.match(body, /Quill/);
  assert.doesNotMatch(body, /sourceMappingURL/);
  for (const probe of ["quill-2.0.3.js.map", "quill.js", "quill.core.js", "..%2Fpackage.json", "quill-2.0.4.js"]) {
    assert.equal((await fetch(`${baseUrl}/questionnaire/assets/${probe}`)).status, 404, probe);
  }
});

// Admin and MCP readback

test("admin response pages render rich answers through the allow-listed renderer and plain fallbacks as text", async () => {
  const questionnaire = store.create({ title: "Rich", questions: richQuestions });
  const draft = await browserDraft(questionnaire);
  const submitted = await draft.submit({
    story: doc({ insert: "<b>Hi</b> " }, { insert: "site", attributes: { link: "https://example.com/x" } }, { insert: "\n" }),
    plain: "<script>alert(1)</script>",
    rooms: [{ row_id: "r1", values: { notes: "legacy <em>plain</em>" } }],
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const detail = await fetch(`${baseUrl}/questionnaires/${questionnaire.questionnaire_id}/responses/${draft.responseId}`, { headers: trustedHeaders });
  assert.equal(detail.status, 200);
  const html = await detail.text();
  assert.match(html, /<div class="rich-answer"><p>&lt;b&gt;Hi&lt;\/b&gt; <a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer nofollow">site<\/a><\/p><\/div>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /legacy &lt;em&gt;plain&lt;\/em&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("MCP accepts rich_text definitions and Delta answers and reads them back unchanged", async () => {
  const client = new Client({ name: "questionnaire-rich-text-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  try {
    const created = await client.callTool({ name: "create_questionnaire", arguments: { title: "Rich", questions: richQuestions } });
    assert.equal(created.isError, undefined, created.content?.[0]?.text);
    const questionnaireId = created.structuredContent.questionnaire_id;
    const read = await client.callTool({ name: "get_questionnaire", arguments: { questionnaire_id: questionnaireId } });
    assert.deepEqual(read.structuredContent.questions[0].settings, { rich_text: true });
    const story = doc({ insert: "From MCP", attributes: { bold: true } }, { insert: "\n" });
    let result = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: questionnaireId, answers: { story: doc({ insert: "x", attributes: { link: "data:text/html,x" } }, { insert: "\n" }) } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /story: links must be http or https URLs/);
    result = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: questionnaireId, answers: { story, rooms: [] } } });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.deepEqual(result.structuredContent.answers.story, story);
  } finally {
    await client.close();
  }
});

test("plain-string answers to rich questions follow the same visible-text rules as documents; ordinary plain questions are unchanged", async () => {
  const questions = [
    { id: "story", type: "long_text", title: "Story", required: true, settings: { rich_text: true }, validation: { min_length: 3 } },
    { id: "optional", type: "long_text", title: "Optional", settings: { rich_text: true } },
    { id: "plain", type: "long_text", title: "Plain", required: true, validation: { min_length: 3 } },
    { id: "rooms", type: "repeatable_rows", title: "Rooms", fields: [{ id: "notes", type: "long_text", title: "Notes", required: true, settings: { rich_text: true }, validation: { min_length: 3 } }] },
  ];
  const questionnaire = store.create({ title: "Fallback", questions });
  const draft = await browserDraft(questionnaire);
  const invisible = "​​​";
  const failsWith = async (answers, pattern) => {
    const result = await draft.submit(answers);
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, pattern);
  };
  const valid = { story: "Fine", plain: "abc", rooms: [{ row_id: "r1", values: { notes: "Tidy" } }] };
  await failsWith({ ...valid, story: invisible }, /^story: an answer is required$/);
  await failsWith({ ...valid, story: " ⁠﻿ " }, /^story: an answer is required$/);
  await failsWith({ ...valid, rooms: [{ row_id: "r1", values: { notes: invisible } }] }, /^rooms\[1\]\.notes: an answer is required$/);
  await failsWith({ ...valid, story: "ab" }, /^story: answer must contain at least 3 characters$/);

  // Drafts drop invisible-only fallbacks like empty documents; visible strings stay strings.
  let saved = await draft.save({ ...valid, optional: invisible, rooms: [{ row_id: "r1", values: { notes: invisible } }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(Object.hasOwn(saved.body.answers, "optional"), false);
  assert.deepEqual(saved.body.answers.rooms, [{ row_id: "r1", values: {} }]);

  // An ordinary plain question keeps its existing string semantics.
  const submitted = await draft.submit({ ...valid, plain: invisible, optional: "  plain <b>kept</b>  " });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.answers.plain, invisible);
  assert.equal(submitted.body.answers.optional, "  plain <b>kept</b>  ");
  assert.equal(submitted.body.answers.story, "Fine");

  const client = new Client({ name: "questionnaire-rich-fallback-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  try {
    const result = await client.callTool({ name: "submit_questionnaire_response", arguments: { questionnaire_id: questionnaire.questionnaire_id, answers: { ...valid, story: invisible } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /story: an answer is required/);
  } finally {
    await client.close();
  }
});

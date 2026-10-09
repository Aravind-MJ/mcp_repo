import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Script } from "node:vm";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { QuestionnaireStore } from "../src/questionnaire/store.js";

const sharedSecret = "s".repeat(64);
let root;
let server;
let baseUrl;
let config;
let store;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-uploads-rows-test-"));
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

async function mcpClient() {
  const client = new Client({ name: "questionnaire-uploads-rows-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/questionnaire/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedSecret}` } },
  }));
  return client;
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return result;
}

const uploadAndRowQuestions = [
  { id: "receipt", type: "file_upload", title: "Receipt photo", required: true },
  {
    id: "rooms",
    type: "repeatable_rows",
    title: "Rooms",
    required: true,
    fields: [
      { id: "name", type: "short_text", title: "Room name", required: true, validation: { max_length: 40 } },
      { id: "size", type: "number", title: "Size", validation: { min: 1 } },
      { id: "kind", type: "single_choice", title: "Kind", options: [{ value: "bed", label: "Bedroom" }, { value: "bath", label: "Bathroom" }] },
      { id: "photo", type: "file_upload", title: "Photo", settings: { formats: ["png", "webp"], max_files: 3, max_bytes: 2 * 1024 * 1024 } },
    ],
  },
];

test("MCP creates and reads back file_upload and repeatable_rows definitions with documented defaults", async () => {
  const client = await mcpClient();
  try {
    const created = await callTool(client, "create_questionnaire", { title: "Inventory", questions: uploadAndRowQuestions });
    assert.equal(created.isError, undefined, created.content?.[0]?.text);
    const fetched = await callTool(client, "get_questionnaire", { questionnaire_id: created.structuredContent.questionnaire_id });
    const [receipt, rooms] = fetched.structuredContent.questions;
    assert.deepEqual(receipt.settings, { formats: ["jpeg", "png", "webp"], min_files: 0, max_files: 1, max_bytes: 5 * 1024 * 1024 });
    assert.deepEqual(rooms.settings, { min_rows: 0, max_rows: 10, add_label: "Add row" });
    assert.deepEqual(rooms.fields.map((field) => [field.id, field.type]), [["name", "short_text"], ["size", "number"], ["kind", "single_choice"], ["photo", "file_upload"]]);
    assert.deepEqual(rooms.fields[3].settings, { formats: ["png", "webp"], min_files: 0, max_files: 3, max_bytes: 2 * 1024 * 1024 });
  } finally {
    await client.close();
  }
});

test("definitions reject SVG, oversized limits, nested groups, conditional row fields, and too many rows or fields", () => {
  const define = (question) => store.create({ title: "Invalid", questions: [question] });
  const field = (id, extra = {}) => ({ id, type: "short_text", title: id, ...extra });
  assert.throws(() => define({ id: "f", type: "file_upload", title: "F", settings: { formats: ["svg"] } }), /formats/);
  assert.throws(() => define({ id: "f", type: "file_upload", title: "F", settings: { max_bytes: 11 * 1024 * 1024 } }), /max_bytes/);
  assert.throws(() => define({ id: "f", type: "file_upload", title: "F", settings: { max_files: 11 } }), /max_files/);
  assert.throws(() => define({ id: "f", type: "file_upload", title: "F", settings: { min_files: 3, max_files: 2 } }), /min_files/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: [{ id: "inner", type: "repeatable_rows", title: "Inner", fields: [field("a")] }] }), /cannot contain repeatable_rows/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: [field("a", { show_when: ["x"] })] }), /cannot be conditional or nested/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: [field("a", { children: [field("b")] })] }), /cannot be conditional or nested/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: Array.from({ length: 21 }, (_, index) => field(`f${index}`)) }), /between 1 and 20/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: [field("a"), field("a")] }), /unique/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", settings: { max_rows: 51 }, fields: [field("a")] }), /max_rows/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", settings: { min_rows: 4, max_rows: 3 }, fields: [field("a")] }), /min_rows/);
  assert.throws(() => define({ id: "r", type: "repeatable_rows", title: "R", fields: [field("a")], children: [field("b")] }), /children/);
});

function localUrl(publicUrl) {
  return publicUrl.replace(config.publicBaseUrl, baseUrl);
}

function subresourceUrl(signedUrl, suffix, extra = {}) {
  const source = new URL(localUrl(signedUrl));
  const target = new URL(`${source.pathname}${suffix}`, baseUrl);
  target.search = source.search;
  for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
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
    signed,
    responseId,
    editToken,
    url: (suffix = "", extra) => subresourceUrl(signed.url, `/responses/${responseId}${suffix}`, extra),
    save: async (answers) => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}`), { method: "PATCH", headers, body: JSON.stringify({ answers }) })),
    load: async () => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}`), { headers })),
    submit: async (answers, extra = {}) => json(await fetch(subresourceUrl(signed.url, `/responses/${responseId}/submit`), { method: "POST", headers, body: JSON.stringify({ answers, ...extra }) })),
  };
}

const rowsOnly = [
  {
    id: "rooms",
    type: "repeatable_rows",
    title: "Rooms",
    required: true,
    settings: { max_rows: 3 },
    fields: [
      { id: "name", type: "short_text", title: "Room name", required: true, validation: { max_length: 10 } },
      { id: "size", type: "number", title: "Size", validation: { min: 1 } },
      { id: "kind", type: "single_choice", title: "Kind", options: [{ value: "bed", label: "Bedroom" }, { value: "bath", label: "Bathroom" }] },
    ],
  },
];

test("browser drafts keep row IDs and order across add, reorder, and remove, and reject malformed rows with row/field paths", async () => {
  const questionnaire = store.create({ title: "Rooms", questions: rowsOnly });
  const draft = await browserDraft(questionnaire);
  const first = { row_id: "rA1", values: { name: "Kitchen", size: 12 } };
  const second = { row_id: "rB2", values: { name: "Den", kind: "bed" } };
  let saved = await draft.save({ rooms: [first, second] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.answers.rooms, [first, second]);
  saved = await draft.save({ rooms: [second, first] });
  assert.deepEqual(saved.body.answers.rooms.map((row) => row.row_id), ["rB2", "rA1"]);
  saved = await draft.save({ rooms: [first] });
  assert.deepEqual((await draft.load()).body.answers.rooms, [first]);

  const rejected = async (answers, pattern) => {
    const result = await draft.save(answers);
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, pattern);
  };
  await rejected({ rooms: [{ row_id: "rA1", values: { ghost: "x" } }] }, /^rooms\[1\]: unknown field ghost$/);
  await rejected({ rooms: [first, { row_id: "rC3", values: { name: "Far too long name" } }] }, /^rooms\[2\]\.name: answer must contain at most 10 characters$/);
  await rejected({ rooms: [first, { row_id: "rA1", values: {} }] }, /^rooms\[2\]: row_id must be unique$/);
  await rejected({ rooms: [{ row_id: "bad id", values: {} }] }, /^rooms\[1\]: row_id must/);
  await rejected({ rooms: [{ row_id: "rA1", values: {}, extra: true }] }, /^rooms\[1\]: rows may only contain row_id and values$/);
  await rejected({ rooms: "nope" }, /^rooms: answer must be an array of rows$/);
  await rejected({ rooms: Array.from({ length: 4 }, (_, index) => ({ row_id: `r${index}`, values: {} })) }, /^rooms: add no more than 3 rows$/);
  await rejected({ rooms: [{ row_id: "rA1", values: { kind: "attic" } }] }, /^rooms\[1\]\.kind: answer must be one of the available options$/);

  let submitted = await draft.submit({ rooms: [] });
  assert.equal(submitted.status, 400);
  assert.match(submitted.body.error, /^rooms: add at least 1 row$/);
  submitted = await draft.submit({ rooms: [{ row_id: "rA1", values: { size: 3 } }] });
  assert.match(submitted.body.error, /^rooms\[1\]\.name: an answer is required$/);
  submitted = await draft.submit({ rooms: [{ row_id: "rA1", values: { name: "Hall", size: 0 } }] });
  assert.match(submitted.body.error, /^rooms\[1\]\.size: answer must be at least 1$/);
  submitted = await draft.submit({ rooms: [second, first] });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.deepEqual(submitted.body.answers.rooms, [second, first]);
});

test("MCP submission reports the same row and field errors and preserves row order", async () => {
  const questionnaire = store.create({ title: "Rooms", questions: rowsOnly });
  const client = await mcpClient();
  try {
    const submit = (answers) => callTool(client, "submit_questionnaire_response", { questionnaire_id: questionnaire.questionnaire_id, answers });
    let result = await submit({ rooms: [{ row_id: "x1", values: { ghost: 1 } }] });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /rooms\[1\]: unknown field ghost/);
    result = await submit({ rooms: [] });
    assert.match(result.content[0].text, /rooms: add at least 1 row/);
    result = await submit({ rooms: [{ row_id: "x1", values: { name: "A" } }, { row_id: "x2", values: {} }] });
    assert.match(result.content[0].text, /rooms\[2\]\.name: an answer is required/);
    result = await submit({ rooms: [{ row_id: "x2", values: { name: "B" } }, { row_id: "x1", values: { name: "A", size: 4 } }] });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.deepEqual(result.structuredContent.answers.rooms.map((row) => row.row_id), ["x2", "x1"]);
  } finally {
    await client.close();
  }
});

test("optional groups accept zero rows but otherwise enforce min_rows", async () => {
  const questionnaire = store.create({ title: "Optional", questions: [{ id: "pets", type: "repeatable_rows", title: "Pets", settings: { min_rows: 2 }, fields: [{ id: "name", type: "short_text", title: "Name" }] }] });
  const draft = await browserDraft(questionnaire);
  let result = await draft.submit({ pets: [{ row_id: "p1", values: { name: "Rex" } }] });
  assert.match(result.body.error, /^pets: add at least 2 rows$/);
  result = await draft.submit({ pets: [] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

async function realImage(format, { width = 64, height = 48, exif = true } = {}) {
  let image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
  image = format === "jpeg" ? image.jpeg() : format === "png" ? image.png() : image.webp();
  if (exif) image = image.withExif({ IFD0: { Copyright: "private-owner", ImageDescription: "home address" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 0/1" } });
  return image.toBuffer();
}

const CONTENT_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function capability(draft, target) {
  return json(await fetch(draft.url("/attachments/capability"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": draft.editToken },
    body: JSON.stringify(target),
  }));
}

async function upload(draft, target, bytes, { contentType = "image/jpeg", filename = "photo.jpg", editToken = draft.editToken, grant } = {}) {
  const granted = grant ?? (await capability(draft, target)).body;
  const query = { question_id: target.question_id, filename, upload_expires: String(granted.upload_expires), upload_signature: granted.upload_signature };
  if (target.row_id) query.row_id = target.row_id;
  if (target.field_id) query.field_id = target.field_id;
  return json(await fetch(draft.url("/attachments", query), {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Questionnaire-Edit-Token": editToken },
    body: bytes,
  }));
}

test("browser uploads re-encode real images without metadata, bind them to question and row, and management MCP returns expiring private download URLs", async () => {
  const questionnaire = store.create({ title: "Inventory", questions: uploadAndRowQuestions });
  const draft = await browserDraft(questionnaire);
  const jpeg = await realImage("jpeg");
  assert.ok((await sharp(jpeg).metadata()).exif, "fixture must carry EXIF");

  const grant = await capability(draft, { question_id: "receipt" });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  assert.deepEqual(grant.body.formats, ["jpeg", "png", "webp"]);
  assert.equal(grant.body.max_bytes, 5 * 1024 * 1024);
  assert.ok(Date.parse(grant.body.expires_at) - Date.now() <= 5 * 60_000);

  const receipt = await upload(draft, { question_id: "receipt" }, jpeg, { grant: grant.body, filename: "IMG 0042.jpg" });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  assert.match(receipt.body.attachment_id, /^[A-Za-z0-9]{24}$/);
  assert.equal(receipt.body.content_type, "image/jpeg");
  assert.equal(receipt.body.width, 64);
  assert.equal(receipt.body.height, 48);
  assert.equal(receipt.body.filename, "IMG 0042.jpg");

  const preview = await fetch(draft.url(`/attachments/${receipt.body.attachment_id}`), { headers: { "X-Questionnaire-Edit-Token": draft.editToken } });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/jpeg");
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  const stored = Buffer.from(await preview.arrayBuffer());
  const storedMetadata = await sharp(stored).metadata();
  assert.equal(storedMetadata.format, "jpeg");
  assert.equal(storedMetadata.exif, undefined);
  assert.equal(storedMetadata.icc, undefined);
  assert.equal(stored.includes(Buffer.from("private-owner")), false);
  assert.equal((await fetch(draft.url(`/attachments/${receipt.body.attachment_id}`))).status, 404);

  const png = await upload(draft, { question_id: "rooms", row_id: "r1", field_id: "photo" }, await realImage("png"), { contentType: "image/png", filename: "room.png" });
  assert.equal(png.status, 201, JSON.stringify(png.body));
  assert.equal(png.body.content_type, "image/png");

  let saved = await draft.save({ receipt: [receipt.body.attachment_id], rooms: [{ row_id: "r2", values: { name: "Den", photo: [png.body.attachment_id] } }] });
  assert.equal(saved.status, 400);
  assert.match(saved.body.error, /^rooms\[1\]\.photo: attachment .* is not available here$/);
  saved = await draft.save({ rooms: [{ row_id: "r1", values: { name: "Den", photo: [receipt.body.attachment_id] } }] });
  assert.match(saved.body.error, /^rooms\[1\]\.photo: attachment .* is not available here$/);
  saved = await draft.save({ receipt: [receipt.body.attachment_id], rooms: [{ row_id: "r1", values: { name: "Den", photo: [png.body.attachment_id] } }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const reloaded = await draft.load();
  assert.deepEqual(reloaded.body.answers.receipt, [receipt.body.attachment_id]);
  assert.equal(reloaded.body.attachments[png.body.attachment_id].filename, "room.png");
  assert.equal(reloaded.body.attachments[png.body.attachment_id].row_id, "r1");

  const submitted = await draft.submit(reloaded.body.answers);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

  const client = await mcpClient();
  try {
    const result = await callTool(client, "get_questionnaire_response", { questionnaire_id: questionnaire.questionnaire_id, response_id: draft.responseId });
    const attachments = result.structuredContent.attachments;
    assert.deepEqual(attachments.map((item) => [item.question_id, item.row_id, item.field_id]).sort(), [["receipt", null, null], ["rooms", "r1", "photo"]]);
    const download = attachments.find((item) => item.question_id === "receipt");
    assert.match(download.download_url, /^https:\/\/mcp\.example\.test\/questionnaire\/[A-Za-z0-9]{24}\/attachments\/[A-Za-z0-9]{24}\?expires=\d+&signature=[a-f0-9]{64}$/);
    assert.ok(Date.parse(download.expires_at) - Date.now() <= 60 * 60_000);
    const fetched = await fetch(localUrl(download.download_url));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
    assert.match(fetched.headers.get("content-security-policy"), /sandbox/);
    assert.match(fetched.headers.get("x-robots-tag"), /noindex/);
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), stored);
    const tampered = new URL(localUrl(download.download_url));
    tampered.searchParams.set("signature", "0".repeat(64));
    assert.equal((await fetch(tampered)).status, 404);

    const other = await callTool(client, "submit_questionnaire_response", {
      questionnaire_id: questionnaire.questionnaire_id,
      answers: { receipt: [receipt.body.attachment_id], rooms: [{ row_id: "r1", values: { name: "Den" } }] },
    });
    assert.equal(other.isError, true);
    assert.match(other.content[0].text, /receipt: attachment .* is not available here/);
  } finally {
    await client.close();
  }
});

async function attachmentFiles() {
  const { readdir } = await import("node:fs/promises");
  const directory = path.join(config.dataDir, "questionnaire", "attachments");
  const result = [];
  for (const questionnaire of await readdir(directory).catch(() => [])) {
    for (const name of await readdir(path.join(directory, questionnaire))) result.push(name);
  }
  return result;
}

function attachmentRows() {
  return store.db.prepare("SELECT id, status FROM questionnaire_attachments").all();
}

test("uploads require the draft edit token and a capability scoped to this response, revision, question, row, and field", async () => {
  const questionnaire = store.create({ title: "Scoped", questions: [...uploadAndRowQuestions, { id: "other", type: "file_upload", title: "Other" }] });
  const draft = await browserDraft(questionnaire);
  const otherDraft = await browserDraft(questionnaire);
  const jpeg = await realImage("jpeg", { exif: false });
  const grant = (await capability(draft, { question_id: "receipt" })).body;

  assert.equal((await upload(draft, { question_id: "receipt" }, jpeg, { grant, editToken: "" })).status, 404);
  assert.equal((await upload(draft, { question_id: "receipt" }, jpeg, { grant, editToken: otherDraft.editToken })).status, 404);
  const bearer = await fetch(draft.url("/attachments", { question_id: "receipt", upload_expires: String(grant.upload_expires), upload_signature: grant.upload_signature }), {
    method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${sharedSecret}` }, body: jpeg,
  });
  assert.equal(bearer.status, 404, "the management bearer secret never substitutes for draft ownership");
  assert.equal((await upload(draft, { question_id: "other" }, jpeg, { grant })).status, 403);
  assert.equal((await upload(otherDraft, { question_id: "receipt" }, jpeg, { grant })).status, 403);
  const rowGrant = (await capability(draft, { question_id: "rooms", row_id: "r1", field_id: "photo" })).body;
  assert.equal((await upload(draft, { question_id: "rooms", row_id: "r2", field_id: "photo" }, jpeg, { grant: rowGrant, contentType: "image/png" })).status, 403);
  const tampered = { ...grant, upload_signature: grant.upload_signature.replace(/.$/, (character) => (character === "0" ? "1" : "0")) };
  assert.equal((await upload(draft, { question_id: "receipt" }, jpeg, { grant: tampered })).status, 403);
  const row = store.db.prepare("SELECT * FROM responses WHERE id = ?").get(draft.responseId);
  const target = store.attachments.resolveTarget(questionnaire, { question_id: "receipt" });
  const past = Math.floor(Date.now() / 1000) - 1;
  const expired = { upload_expires: past, upload_signature: await store.attachments.hmac(store.attachments.capabilityPayload(row, target, past)) };
  assert.equal((await upload(draft, { question_id: "receipt" }, jpeg, { grant: expired })).status, 403);

  const badTargets = [{ question_id: "missing" }, { question_id: "rooms", row_id: "r1", field_id: "name" }, { question_id: "rooms", row_id: "bad id", field_id: "photo" }, { question_id: "receipt", row_id: "r1" }];
  for (const target of badTargets) assert.equal((await capability(draft, target)).status, 400, JSON.stringify(target));

  const crossSite = await fetch(draft.url("/attachments", { question_id: "receipt", upload_expires: String(grant.upload_expires), upload_signature: grant.upload_signature }), {
    method: "POST", headers: { "Content-Type": "image/jpeg", "X-Questionnaire-Edit-Token": draft.editToken, Origin: "https://evil.example" }, body: jpeg,
  });
  assert.equal(crossSite.status, 403);
  assert.deepEqual(attachmentRows(), []);
  assert.deepEqual(await attachmentFiles(), []);

  const ok = await upload(draft, { question_id: "receipt" }, jpeg, { grant });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await fetch(otherDraft.url(`/attachments/${ok.body.attachment_id}`), { headers: { "X-Questionnaire-Edit-Token": otherDraft.editToken } })).status, 404);
  assert.equal((await otherDraft.save({ receipt: [ok.body.attachment_id] })).status, 400);

  await draft.submit({ receipt: [ok.body.attachment_id], rooms: [{ row_id: "r1", values: { name: "A" } }] });
  const afterSubmit = await capability(draft, { question_id: "receipt" });
  assert.equal(afterSubmit.status, 409);
  store.setStatus(questionnaire.questionnaire_id, "closed");
  assert.equal((await capability(otherDraft, { question_id: "receipt" })).status, 409);
});

test("uploads reject SVG, mislabelled or corrupt bytes, disallowed formats, oversized bodies, and oversized dimensions without leaving files", async () => {
  const questionnaire = store.create({ title: "Content", questions: [
    { id: "small", type: "file_upload", title: "Small", settings: { max_bytes: 4096 } },
    ...uploadAndRowQuestions,
  ] });
  const draft = await browserDraft(questionnaire);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  const rejects = async (target, bytes, contentType, status, pattern) => {
    const result = await upload(draft, target, bytes, { contentType });
    assert.equal(result.status, status, JSON.stringify(result.body));
    if (pattern) assert.match(result.body.error, pattern);
  };
  await rejects({ question_id: "receipt" }, svg, "image/svg+xml", 415);
  await rejects({ question_id: "receipt" }, svg, "image/png", 415, /SVG are not accepted/);
  await rejects({ question_id: "receipt" }, Buffer.from("plain text pretending to be a photo"), "image/jpeg", 415);
  const jpeg = await realImage("jpeg", { exif: false });
  await rejects({ question_id: "receipt" }, Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(400, 7)]), "image/jpeg", 415, /could not be decoded/);
  await rejects({ question_id: "receipt" }, await realImage("png", { exif: false }), "image/jpeg", 415, /does not match|not accepted|could not/);
  await rejects({ question_id: "rooms", row_id: "r1", field_id: "photo" }, jpeg, "image/jpeg", 415);
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).gif().toBuffer();
  await rejects({ question_id: "receipt" }, gif, "image/png", 415);

  const noise = await sharp(randomBytes(96 * 96 * 3), { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer();
  assert.ok(noise.length > 4096);
  await rejects({ question_id: "small" }, noise, "image/png", 413);
  const grant = (await capability(draft, { question_id: "small" })).body;
  const chunked = await fetch(draft.url("/attachments", { question_id: "small", upload_expires: String(grant.upload_expires), upload_signature: grant.upload_signature }), {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-Questionnaire-Edit-Token": draft.editToken },
    body: new ReadableStream({ start(controller) { controller.enqueue(noise.subarray(0, 3000)); controller.enqueue(noise.subarray(3000)); controller.close(); } }),
    duplex: "half",
  });
  assert.equal(chunked.status, 413, "streamed bodies without Content-Length are still bounded by actual bytes");

  const wide = await sharp({ create: { width: 10_001, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await rejects({ question_id: "receipt" }, wide, "image/png", 413, /pixels/);
  store.attachments.limits = { ...store.attachments.limits, maxPixels: 1_000 };
  await rejects({ question_id: "receipt" }, await realImage("webp", { width: 40, height: 40, exif: false }), "image/webp", 413, /pixels/);

  assert.deepEqual(attachmentRows(), []);
  assert.deepEqual(await attachmentFiles(), []);
});

async function slowUpload(draft, target, firstChunk, contentType = "image/jpeg") {
  const grant = (await capability(draft, target)).body;
  const url = new URL(draft.url("/attachments", { question_id: target.question_id, upload_expires: String(grant.upload_expires), upload_signature: grant.upload_signature }));
  const request = httpRequest(url, { method: "POST", headers: { "Content-Type": contentType, "X-Questionnaire-Edit-Token": draft.editToken, "Transfer-Encoding": "chunked" } });
  const response = new Promise((resolve, reject) => {
    request.on("response", (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") }));
    });
    request.on("error", reject);
  });
  request.write(firstChunk);
  return { request, response };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

const reservedCount = () => attachmentRows().filter((row) => row.status === "reserved").length;

test("concurrent upload quotas apply per response and per source, and aborted uploads release reservations and partial files", async () => {
  const questionnaire = store.create({ title: "Busy", questions: [{ id: "photos", type: "file_upload", title: "Photos", settings: { max_files: 5 } }] });
  const draft = await browserDraft(questionnaire);
  const jpeg = await realImage("jpeg", { exif: false });
  const first = await slowUpload(draft, { question_id: "photos" }, jpeg.subarray(0, 100));
  const second = await slowUpload(draft, { question_id: "photos" }, jpeg.subarray(0, 100));
  await waitFor(() => reservedCount() === 2, "two uploads should hold reservations");
  const third = await upload(draft, { question_id: "photos" }, jpeg);
  assert.equal(third.status, 429);
  assert.match(third.body.error, /At most 2 uploads/);

  first.request.destroy();
  await first.response.catch(() => {});
  await waitFor(() => reservedCount() === 1, "the aborted upload should release its reservation");
  await waitFor(async () => {
    const files = await attachmentFiles();
    return files.length === 1 && files[0].endsWith(".upload");
  }, "the aborted upload should remove its partial file, leaving only the in-progress one");

  second.request.end(jpeg.subarray(100));
  const finished = await second.response;
  assert.equal(finished.status, 201, JSON.stringify(finished.body));
  assert.equal(reservedCount(), 0);
  assert.deepEqual(await attachmentFiles(), [finished.body.attachment_id]);

  store.attachments.limits = { ...store.attachments.limits, concurrentPerSource: 1 };
  const otherDraft = await browserDraft(questionnaire);
  const held = await slowUpload(draft, { question_id: "photos" }, jpeg.subarray(0, 100));
  await waitFor(() => reservedCount() === 1, "held upload should reserve");
  const blocked = await upload(otherDraft, { question_id: "photos" }, jpeg);
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /from this network/);
  held.request.destroy();
  await held.response.catch(() => {});
  await waitFor(() => reservedCount() === 0, "released");
  assert.equal((await upload(otherDraft, { question_id: "photos" }, jpeg)).status, 201);
});

test("storage quotas cap attachments per response and reserved bytes per questionnaire", async () => {
  const questionnaire = store.create({ title: "Quota", questions: [{ id: "photos", type: "file_upload", title: "Photos", settings: { max_files: 5, max_bytes: 1024 * 1024 } }] });
  const jpeg = await realImage("jpeg", { exif: false });
  store.attachments.limits = { ...store.attachments.limits, maxAttachmentsPerResponse: 1 };
  const draft = await browserDraft(questionnaire);
  assert.equal((await upload(draft, { question_id: "photos" }, jpeg)).status, 201);
  const full = await upload(draft, { question_id: "photos" }, jpeg);
  assert.equal(full.status, 409);
  assert.match(full.body.error, /response has reached its upload storage limit/);

  store.attachments.limits = { ...store.attachments.limits, maxAttachmentsPerResponse: 100, maxBytesPerQuestionnaire: 1024 * 1024 + 10 };
  const otherDraft = await browserDraft(questionnaire);
  const blocked = await upload(otherDraft, { question_id: "photos" }, jpeg);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /questionnaire has reached its upload storage limit/);
  assert.equal(reservedCount(), 0);
});

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

async function uploadedDraft(questionnaire, count = 1) {
  const draft = await browserDraft(questionnaire);
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const result = await upload(draft, { question_id: "photos" }, await realImage("png", { exif: false }), { contentType: "image/png" });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    ids.push(result.body.attachment_id);
  }
  return { draft, ids };
}

test("deleting a response or questionnaire removes its stored image files", async () => {
  const questionnaire = store.create({ title: "Delete", questions: [{ id: "photos", type: "file_upload", title: "Photos", settings: { max_files: 2 } }] });
  const keep = await uploadedDraft(questionnaire);
  const gone = await uploadedDraft(questionnaire);
  store.deleteResponse(questionnaire.questionnaire_id, gone.draft.responseId);
  assert.deepEqual(await attachmentFiles(), keep.ids);
  const client = await mcpClient();
  try {
    await callTool(client, "delete_questionnaire", { questionnaire_id: questionnaire.questionnaire_id });
  } finally {
    await client.close();
  }
  assert.deepEqual(await attachmentFiles(), []);
  assert.deepEqual(attachmentRows(), []);
  await assert.rejects(readdir(path.join(config.dataDir, "questionnaire", "attachments", questionnaire.questionnaire_id)), { code: "ENOENT" });
});

test("lifecycle removes abandoned upload drafts after 7 days, unreferenced files after 24 hours, stale reservations, and orphans, but keeps submitted references", async () => {
  const questionnaire = store.create({ title: "Retention", questions: [{ id: "photos", type: "file_upload", title: "Photos", settings: { max_files: 2 } }] });
  const abandoned = await uploadedDraft(questionnaire);
  assert.equal((await abandoned.draft.save({ photos: abandoned.ids })).status, 200);
  const active = await uploadedDraft(questionnaire);
  const plain = await browserDraft(questionnaire);
  const submitted = await uploadedDraft(questionnaire, 2);
  assert.equal((await submitted.draft.save({ photos: submitted.ids })).status, 200);
  // Replacing the second image leaves it unreferenced; the first stays referenced through submission.
  assert.equal((await submitted.draft.submit({ photos: [submitted.ids[0]] })).status, 200);

  const directory = path.join(config.dataDir, "questionnaire", "attachments");
  const orphan = path.join(directory, questionnaire.questionnaire_id, "Z".repeat(24));
  await writeFile(orphan, "orphan");
  const ghostDirectory = path.join(directory, "Y".repeat(24));
  await mkdir(ghostDirectory);
  await writeFile(path.join(ghostDirectory, "X".repeat(24)), "ghost");
  const row = store.db.prepare("SELECT * FROM responses WHERE id = ?").get(active.draft.responseId);
  const staleId = store.attachments.reserve(row, store.attachments.resolveTarget(questionnaire, { question_id: "photos" }), "source");
  await writeFile(path.join(directory, questionnaire.questionnaire_id, `${staleId}.upload`), "partial");

  const now = Date.now();
  let result = store.attachments.runLifecycle(now + 23 * HOUR);
  assert.equal(result.unreferenced_attachments, 0);
  assert.equal(result.orphan_files, 2);
  assert.equal(result.expired_reservations, 1);
  assert.ok((await attachmentFiles()).includes(submitted.ids[1]), "unreferenced files have a 24-hour grace period");
  assert.ok((await attachmentFiles()).includes(active.ids[0]), "the active draft's unsaved upload is still within grace");

  result = store.attachments.runLifecycle(now + 25 * HOUR);
  assert.equal(result.unreferenced_attachments, 2);
  assert.equal(result.abandoned_drafts, 0);
  assert.deepEqual((await attachmentFiles()).sort(), [abandoned.ids[0], submitted.ids[0]].sort());

  // The active draft has no images left, so inactivity alone never deletes an image-free draft.
  result = store.attachments.runLifecycle(now + 8 * DAY);
  assert.equal(result.abandoned_drafts, 1);
  assert.throws(() => store.getResponse(questionnaire.questionnaire_id, abandoned.draft.responseId), /not found/);
  assert.equal(store.getResponse(questionnaire.questionnaire_id, plain.responseId).status, "draft");
  assert.equal(store.getResponse(questionnaire.questionnaire_id, active.draft.responseId).status, "draft");
  assert.deepEqual(await attachmentFiles(), [submitted.ids[0]]);

  result = store.attachments.runLifecycle(now + 400 * DAY);
  assert.deepEqual(await attachmentFiles(), [submitted.ids[0]], "submitted references are kept until explicit deletion");
  assert.deepEqual(store.getResponse(questionnaire.questionnaire_id, submitted.draft.responseId).attachments.map((item) => item.attachment_id), [submitted.ids[0]]);
});

test("recent activity postpones abandoned-draft expiry", async () => {
  const questionnaire = store.create({ title: "Recent", questions: [{ id: "photos", type: "file_upload", title: "Photos" }] });
  const { draft, ids } = await uploadedDraft(questionnaire);
  assert.equal((await draft.save({ photos: ids })).status, 200);
  assert.equal(store.attachments.runLifecycle(Date.now() + 6 * DAY).abandoned_drafts, 0);
  assert.equal(store.attachments.runLifecycle(Date.now() + 7 * DAY + HOUR).abandoned_drafts, 1);
});

test("the app schedules lifecycle cleanup periodically and stops it on close", async () => {
  assert.ok(store.lifecycleTimer, "createApp starts the lifecycle timer");
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const calls = mock.method(store.attachments, "runLifecycle", () => ({}));
    store.startLifecycle();
    mock.timers.tick(store.attachments.limits.lifecycleIntervalMs);
    assert.equal(calls.mock.callCount(), 1);
    mock.timers.tick(store.attachments.limits.lifecycleIntervalMs);
    assert.equal(calls.mock.callCount(), 2);
    calls.mock.mockImplementation(() => { throw new Error("disk unavailable"); });
    const logged = mock.method(console, "error", () => {});
    mock.timers.tick(store.attachments.limits.lifecycleIntervalMs);
    assert.equal(logged.mock.callCount(), 1);
    store.close();
    mock.timers.tick(store.attachments.limits.lifecycleIntervalMs);
    assert.equal(calls.mock.callCount(), 3);
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
});

test("uploads work in anonymous, self_report, and email_verified drafts while final email verification is unchanged", async () => {
  const sent = [];
  store.mailer = { configured: true, async sendVerificationCode(message) { sent.push(message); } };
  const questions = [{ id: "photos", type: "file_upload", title: "Photos", required: true }];
  for (const mode of ["anonymous", "self_report", "email_verified"]) {
    const questionnaire = store.create({ title: mode, authentication_type: mode, questions });
    const { draft, ids } = await uploadedDraft(questionnaire);
    assert.equal((await draft.save({ photos: ids })).status, 200);
    const respondent = mode === "anonymous" ? undefined : { name: "Ada", email: "ada@example.com" };
    if (mode === "email_verified") {
      const unverified = await draft.submit({ photos: ids }, { respondent });
      assert.equal(unverified.status, 403);
      const headers = { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": draft.editToken };
      assert.equal((await fetch(draft.url("/verification"), { method: "POST", headers, body: JSON.stringify({ respondent }) })).status, 202);
      const confirmed = await json(await fetch(draft.url("/verification/confirm"), { method: "POST", headers, body: JSON.stringify({ email: respondent.email, code: sent.at(-1).code }) }));
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      const result = await draft.submit({ photos: ids }, { respondent, verification_proof: confirmed.body.verification_proof });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.identity_status, "email_verified");
    } else {
      const result = await draft.submit({ photos: ids }, respondent ? { respondent } : {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }
    assert.deepEqual(store.getResponse(questionnaire.questionnaire_id, draft.responseId).attachments.map((item) => item.attachment_id), ids);
  }
});

test("answer page renders accessible upload and repeatable row controls with retention copy and a blob-only image CSP", async () => {
  const questionnaire = store.create({ title: "Inventory", questions: uploadAndRowQuestions });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const response = await fetch(localUrl(signed.url));
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /img-src blob:/);
  assert.doesNotMatch(csp, /img-src[^;]*(\*|https?:|data:)/);
  const html = await response.text();
  assert.match(html, /<input[^>]*type="file"[^>]*id="q-receipt"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /data-upload="receipt"[^>]*data-max-files="1"[^>]*data-max-bytes="5242880"/);
  assert.match(html, /JPEG, PNG, or WebP · up to 5 MB · 1 image/);
  assert.match(html, /Unsubmitted drafts with images are deleted after 7 days without activity/);
  assert.match(html, /removed images are deleted after 24 hours/);
  assert.match(html, /data-rows="rooms"[^>]*data-min-rows="1"[^>]*data-max-rows="10"/);
  assert.match(html, /<template data-row-template="rooms">/);
  assert.match(html, /name="rooms__ROWID__name"/);
  assert.match(html, /data-upload="rooms__ROWID__photo"[^>]*data-upload-question="rooms"[^>]*data-upload-field="photo"/);
  assert.match(html, /accept="image\/png,image\/webp"[^>]*multiple/);
  assert.match(html, /data-add-row[^>]*>Add row/);
  assert.match(html, /data-row-up/);
  assert.match(html, /data-row-down/);
  assert.match(html, /data-row-remove/);
  assert.match(html, /aria-live="polite"[^>]*data-rows-status/);
  for (const script of html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)) new Script(script[1]);
});

// Deterministic noise (mulberry32) so the oversized re-encode case is reproducible.
function seededNoise(length, seed) {
  let state = seed >>> 0;
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    bytes[index] = ((value ^ (value >>> 14)) >>> 0) & 0xff;
  }
  return bytes;
}

test("re-encoded output never exceeds the question's max_bytes, and stored bytes match the file", async () => {
  const maxBytes = 8192;
  const questionnaire = store.create({ title: "Bound", questions: [{ id: "photo", type: "file_upload", title: "Photo", settings: { max_bytes: maxBytes } }] });
  const draft = await browserDraft(questionnaire);
  const input = await sharp(seededNoise(256 * 256 * 3, 42), { raw: { width: 256, height: 256, channels: 3 } }).jpeg({ quality: 10 }).toBuffer();
  assert.ok(input.length <= maxBytes, `fixture input is ${input.length} bytes`);
  const result = await upload(draft, { question_id: "photo" }, input);
  assert.ok([201, 413].includes(result.status), JSON.stringify(result.body));
  if (result.status === 201) {
    assert.ok(result.body.bytes <= maxBytes, `stored ${result.body.bytes} bytes for a ${maxBytes}-byte limit`);
    const file = path.join(config.dataDir, "questionnaire", "attachments", questionnaire.questionnaire_id, result.body.attachment_id);
    assert.equal((await stat(file)).size, result.body.bytes);
  } else {
    assert.match(result.body.error, /after processing/);
    assert.deepEqual(attachmentRows(), []);
    assert.deepEqual(await attachmentFiles(), []);
  }
});

async function secondConnection(limits) {
  const other = new QuestionnaireStore({ ...config, questionnaireMailer: { configured: false }, ...(limits ? { questionnaireUploadLimits: limits } : {}) });
  await other.initialize();
  other.db.exec("PRAGMA busy_timeout = 50");
  return other;
}

// Runs action (on another connection) right after SQL matching pattern first executes on target's connection.
function interleave(target, pattern, action) {
  const realDb = target.db;
  const outcome = { fired: false };
  target.db = new Proxy(realDb, {
    get(object, property) {
      if (property === "prepare") {
        return (sql) => {
          const statement = object.prepare(sql);
          if (outcome.fired || !pattern.test(sql)) return statement;
          // The competing write lands after this statement has read its candidates: the race window.
          const wrap = (method) => (...args) => {
            const result = statement[method](...args);
            if (!outcome.fired) {
              outcome.fired = true;
              try { outcome.value = action(); } catch (error) { outcome.error = error; }
            }
            return result;
          };
          return { all: wrap("all"), get: wrap("get"), run: wrap("run") };
        };
      }
      const value = object[property];
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return { outcome, restore() { target.db = realDb; } };
}

async function assertReferencesExist(questionnaire, responseId) {
  const response = store.getResponse(questionnaire.questionnaire_id, responseId);
  for (const id of response.answers.photos || []) {
    assert.ok(store.attachments.stored(questionnaire.questionnaire_id, id), `answer references deleted attachment ${id}`);
    await stat(path.join(config.dataDir, "questionnaire", "attachments", questionnaire.questionnaire_id, id));
  }
}

for (const operation of ["save", "submit"]) {
  test(`lifecycle cleanup and a concurrent ${operation} on another connection cannot leave a dangling reference`, async () => {
    const questionnaire = store.create({ title: "Race", questions: [{ id: "photos", type: "file_upload", title: "Photos", settings: { max_files: 2 } }] });
    const { draft, ids } = await uploadedDraft(questionnaire);
    const other = await secondConnection();
    const competing = () => operation === "save"
      ? other.saveResponse(questionnaire.questionnaire_id, 1, draft.responseId, draft.editToken, { photos: ids })
      : other.submitResponse(questionnaire.questionnaire_id, 1, draft.responseId, draft.editToken, { photos: ids });
    const hook = interleave(store, /unreferenced_since <= \?/, competing);
    try {
      store.attachments.runLifecycle(Date.now() + 25 * HOUR);
    } finally {
      hook.restore();
      other.close();
    }
    assert.ok(hook.outcome.fired);
    if (hook.outcome.error) assert.match(String(hook.outcome.error.message), /locked|busy/i);
    await assertReferencesExist(questionnaire, draft.responseId);
  });
}

test("attachment ownership is checked in the same transaction as the autosave that references it", async () => {
  const questionnaire = store.create({ title: "Race", questions: [{ id: "photos", type: "file_upload", title: "Photos" }] });
  const { draft, ids } = await uploadedDraft(questionnaire);
  const other = await secondConnection();
  const hook = interleave(store, /SELECT id, question_id, row_id, field_id FROM questionnaire_attachments/, () => other.attachments.runLifecycle(Date.now() + 25 * HOUR));
  let saveError;
  try {
    store.saveResponse(questionnaire.questionnaire_id, 1, draft.responseId, draft.editToken, { photos: ids });
  } catch (error) {
    saveError = error;
  } finally {
    hook.restore();
    other.close();
  }
  assert.ok(hook.outcome.fired);
  if (saveError) assert.match(saveError.message, /not available here/);
  await assertReferencesExist(questionnaire, draft.responseId);
});

test("abandoned-draft cleanup never deletes a draft that another connection just saved", async () => {
  const questionnaire = store.create({ title: "Race", questions: [{ id: "photos", type: "file_upload", title: "Photos" }] });
  const { draft, ids } = await uploadedDraft(questionnaire);
  assert.equal((await draft.save({ photos: ids })).status, 200);
  store.db.prepare("UPDATE responses SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 8 * DAY).toISOString(), draft.responseId);
  const other = await secondConnection();
  const hook = interleave(store, /updated_at < \?/, () => other.saveResponse(questionnaire.questionnaire_id, 1, draft.responseId, draft.editToken, { photos: ids }));
  try {
    store.attachments.runLifecycle(Date.now());
  } finally {
    hook.restore();
    other.close();
  }
  assert.ok(hook.outcome.fired);
  const exists = store.db.prepare("SELECT 1 FROM responses WHERE id = ?").get(draft.responseId);
  if (hook.outcome.error) {
    assert.match(String(hook.outcome.error.message), /locked|busy/i);
    assert.equal(exists, undefined);
  } else {
    assert.ok(exists, "a draft saved after the cleanup started must survive");
    await assertReferencesExist(questionnaire, draft.responseId);
  }
});

test("the global concurrent-upload limit counts live reservations from every connection", async () => {
  const questionnaire = store.create({ title: "Global", questions: [{ id: "photos", type: "file_upload", title: "Photos" }] });
  const otherQuestionnaire = store.create({ title: "Global 2", questions: [{ id: "photos", type: "file_upload", title: "Photos" }] });
  const draft = await browserDraft(questionnaire);
  const jpeg = await realImage("jpeg", { exif: false });
  const held = await slowUpload(draft, { question_id: "photos" }, jpeg.subarray(0, 100));
  await waitFor(() => reservedCount() === 1, "first connection holds a reservation");
  const other = await secondConnection({ concurrentGlobal: 1 });
  try {
    const otherDraft = other.createResponse(otherQuestionnaire.questionnaire_id, 1);
    const row = other.db.prepare("SELECT * FROM responses WHERE id = ?").get(otherDraft.response_id);
    const target = other.attachments.resolveTarget(other.get(otherQuestionnaire.questionnaire_id, 1), { question_id: "photos" });
    assert.throws(() => other.attachments.reserve(row, target, "another-source"), (error) => error.status === 429 && /too many uploads/i.test(error.message));
  } finally {
    other.close();
    held.request.destroy();
    await held.response.catch(() => {});
  }
});

test("optional row groups with min_rows start empty and may return to zero rows", async () => {
  const questionnaire = store.create({ title: "Optional rows", questions: [{ id: "pets", type: "repeatable_rows", title: "Pets", settings: { min_rows: 2 }, fields: [{ id: "name", type: "short_text", title: "Name", required: true }] }] });
  const signed = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, 1);
  const html = await (await fetch(localUrl(signed.url))).text();
  assert.match(html, /data-rows="pets"[^>]*data-min-rows="2"[^>]*data-required="false"/);
  const required = store.create({ title: "Required rows", questions: [{ id: "pets", type: "repeatable_rows", title: "Pets", required: true, fields: [{ id: "name", type: "short_text", title: "Name" }] }] });
  const requiredHtml = await (await fetch(localUrl((await store.createSignedUrl(required.questionnaire_id, undefined, 1)).url))).text();
  assert.match(requiredHtml, /data-rows="pets"[^>]*data-min-rows="1"[^>]*data-required="true"/);
  assert.match(html, /Optional\. If you add rows, add at least 2\./);
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  createQuestionnaireResponseScope,
  createQuestionnaireSignedUrl,
  questionnaireResponseScopeIsValid,
  questionnaireSignedUrlIsValid,
  normalizeQuestionnaireExpiry,
} from "../src/security.js";

let root;
let secretFile;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-signature-test-"));
  secretFile = path.join(root, "secrets", "shared-secret");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "s".repeat(64), { mode: 0o600 });
});

afterEach(async () => rm(root, { recursive: true, force: true }));

test("creates exact-revision questionnaire links with bounded expiry", async () => {
  assert.equal(normalizeQuestionnaireExpiry(), 604800);
  assert.equal(normalizeQuestionnaireExpiry(60), 60);
  assert.equal(normalizeQuestionnaireExpiry(31_536_000), 31_536_000);
  assert.throws(() => normalizeQuestionnaireExpiry(59), /between/);
  assert.throws(() => normalizeQuestionnaireExpiry(31_536_001), /between/);

  const signed = await createQuestionnaireSignedUrl({
    questionnaireId: "Q".repeat(24),
    revision: 3,
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    expiresInSeconds: 3600,
    nowSeconds: 2_000_000_000,
  });
  assert.equal(signed.questionnaire_id, "Q".repeat(24));
  assert.equal(signed.revision, 3);
  assert.equal(signed.expires, 2_000_003_600);
  assert.equal(signed.expires_in_seconds, 3600);
  assert.match(signed.url, /^https:\/\/mcp\.example\.test\/questionnaire\/Q{24}\/r\/3\?expires=2000003600&signature=[a-f0-9]{64}$/);
  const expectedLegacySignature = createHmac("sha256", "s".repeat(64))
    .update(`questionnaire-share:${"Q".repeat(24)}:revision:3:2000003600`, "utf8")
    .digest("hex");
  assert.equal(new URL(signed.url).searchParams.get("signature"), expectedLegacySignature);
});

test("creates revisionless latest links by default and keeps scopes non-transferable", async () => {
  const questionnaireId = "L".repeat(24);
  const signed = await createQuestionnaireSignedUrl({
    questionnaireId,
    publicBaseUrl: "https://mcp.example.test",
    secretFile,
    expiresInSeconds: 3600,
    nowSeconds: 2_000_000_000,
  });
  assert.equal(signed.revision, undefined);
  assert.equal(signed.scope, "latest");
  assert.match(signed.url, /^https:\/\/mcp\.example\.test\/questionnaire\/L{24}\?expires=2000003600&signature=[a-f0-9]{64}$/);

  const parsed = new URL(signed.url);
  const request = {
    questionnaireId,
    expires: parsed.searchParams.get("expires"),
    signature: parsed.searchParams.get("signature"),
    secretFile,
    nowSeconds: 2_000_000_030,
  };
  assert.equal(await questionnaireSignedUrlIsValid(request), true);
  assert.equal(await questionnaireSignedUrlIsValid({ ...request, revision: 1 }), false);
});

test("binds questionnaire signatures to ID, revision, expiry, and signature", async () => {
  const questionnaireId = "A".repeat(24);
  const signed = await createQuestionnaireSignedUrl({ questionnaireId, revision: 2, publicBaseUrl: "https://mcp.example.test", secretFile, expiresInSeconds: 60, nowSeconds: 2_000_000_000 });
  const parsed = new URL(signed.url);
  const expires = parsed.searchParams.get("expires");
  const signature = parsed.searchParams.get("signature");
  const common = { questionnaireId, revision: 2, expires, signature, secretFile, nowSeconds: 2_000_000_030 };

  assert.equal(await questionnaireSignedUrlIsValid(common), true);
  assert.equal(await questionnaireSignedUrlIsValid({ ...common, questionnaireId: "B".repeat(24) }), false);
  assert.equal(await questionnaireSignedUrlIsValid({ ...common, revision: 3 }), false);
  assert.equal(await questionnaireSignedUrlIsValid({ ...common, expires: "2000000059" }), false);
  assert.equal(await questionnaireSignedUrlIsValid({ ...common, signature: "0".repeat(64) }), false);
  assert.equal(await questionnaireSignedUrlIsValid({ ...common, nowSeconds: 2_000_000_061 }), false);
});

test("binds a latest page response scope to its loaded revision and share capability", async () => {
  const common = {
    questionnaireId: "R".repeat(24),
    revision: 3,
    expires: "2000003600",
    shareSignature: "a".repeat(64),
    secretFile,
  };
  const responseSignature = await createQuestionnaireResponseScope(common);
  assert.match(responseSignature, /^[a-f0-9]{64}$/);
  assert.equal(await questionnaireResponseScopeIsValid({ ...common, responseSignature }), true);
  assert.equal(await questionnaireResponseScopeIsValid({ ...common, revision: 4, responseSignature }), false);
  assert.equal(await questionnaireResponseScopeIsValid({ ...common, shareSignature: "b".repeat(64), responseSignature }), false);
  assert.equal(await questionnaireResponseScopeIsValid({ ...common, responseSignature: "0".repeat(64) }), false);
});

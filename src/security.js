import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ServiceError } from "./errors.js";

export const DEFAULT_ARTIFACT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const MIN_ARTIFACT_EXPIRY_SECONDS = 60;
export const MAX_ARTIFACT_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
export const DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS = DEFAULT_ARTIFACT_EXPIRY_SECONDS;
export const MIN_QUESTIONNAIRE_EXPIRY_SECONDS = MIN_ARTIFACT_EXPIRY_SECONDS;
export const MAX_QUESTIONNAIRE_EXPIRY_SECONDS = MAX_ARTIFACT_EXPIRY_SECONDS;

export function normalizeArtifactExpiry(value = DEFAULT_ARTIFACT_EXPIRY_SECONDS) {
  if (!Number.isSafeInteger(value) || value < MIN_ARTIFACT_EXPIRY_SECONDS || value > MAX_ARTIFACT_EXPIRY_SECONDS) {
    throw new ServiceError(
      400,
      `expires_in_seconds must be an integer between ${MIN_ARTIFACT_EXPIRY_SECONDS} and ${MAX_ARTIFACT_EXPIRY_SECONDS}`,
    );
  }
  return value;
}

export function normalizeQuestionnaireExpiry(value = DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS) {
  if (!Number.isSafeInteger(value) || value < MIN_QUESTIONNAIRE_EXPIRY_SECONDS || value > MAX_QUESTIONNAIRE_EXPIRY_SECONDS) {
    throw new ServiceError(
      400,
      `expires_in_seconds must be an integer between ${MIN_QUESTIONNAIRE_EXPIRY_SECONDS} and ${MAX_QUESTIONNAIRE_EXPIRY_SECONDS}`,
    );
  }
  return value;
}

function questionnaireSignaturePayload(questionnaireId, revision, expires) {
  const scope = revision === undefined ? "latest" : `revision:${revision}`;
  return `questionnaire-share:${questionnaireId}:${scope}:${expires}`;
}

export async function createQuestionnaireSignedUrl({
  questionnaireId,
  revision,
  publicBaseUrl,
  secretFile,
  expiresInSeconds = DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!/^[A-Za-z0-9]{24}$/.test(questionnaireId)) throw new ServiceError(404, "Questionnaire not found");
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new ServiceError(404, "Questionnaire revision not found");
  }
  const duration = normalizeQuestionnaireExpiry(expiresInSeconds);
  const expires = nowSeconds + duration;
  const secret = await readSharedSecret(secretFile);
  const signature = createHmac("sha256", secret)
    .update(questionnaireSignaturePayload(questionnaireId, revision, expires), "utf8")
    .digest("hex");
  const pathname = revision === undefined
    ? `/questionnaire/${questionnaireId}`
    : `/questionnaire/${questionnaireId}/r/${revision}`;
  const url = new URL(pathname, `${publicBaseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return {
    questionnaire_id: questionnaireId,
    ...(revision === undefined ? { scope: "latest" } : { scope: "revision", revision }),
    url: url.toString(),
    expires,
    expires_at: new Date(expires * 1000).toISOString(),
    expires_in_seconds: duration,
  };
}

export async function questionnaireSignedUrlIsValid({
  questionnaireId,
  revision,
  expires,
  signature,
  secretFile,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (typeof questionnaireId !== "string" || !/^[A-Za-z0-9]{24}$/.test(questionnaireId)) return false;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) return false;
  if (typeof expires !== "string" || !/^\d{10}$/.test(expires)) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < nowSeconds) return false;
  const secret = await readSharedSecret(secretFile);
  const expected = Buffer.from(
    createHmac("sha256", secret).update(questionnaireSignaturePayload(questionnaireId, revision, expiry), "utf8").digest("hex"),
    "utf8",
  );
  const supplied = Buffer.from(signature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function questionnaireResponseScopePayload(questionnaireId, revision, expires, shareSignature) {
  return `questionnaire-response:${questionnaireId}:revision:${revision}:${expires}:share:${shareSignature}`;
}

function validQuestionnaireResponseScopeInput({ questionnaireId, revision, expires, shareSignature }) {
  return typeof questionnaireId === "string"
    && /^[A-Za-z0-9]{24}$/.test(questionnaireId)
    && Number.isSafeInteger(revision)
    && revision >= 1
    && typeof expires === "string"
    && /^\d{10}$/.test(expires)
    && typeof shareSignature === "string"
    && /^[a-f0-9]{64}$/.test(shareSignature);
}

export async function createQuestionnaireResponseScope({ questionnaireId, revision, expires, shareSignature, secretFile }) {
  if (!validQuestionnaireResponseScopeInput({ questionnaireId, revision, expires, shareSignature })) {
    throw new ServiceError(404, "Questionnaire not found");
  }
  const secret = await readSharedSecret(secretFile);
  return createHmac("sha256", secret)
    .update(questionnaireResponseScopePayload(questionnaireId, revision, expires, shareSignature), "utf8")
    .digest("hex");
}

export async function questionnaireResponseScopeIsValid({ questionnaireId, revision, expires, shareSignature, responseSignature, secretFile }) {
  if (!validQuestionnaireResponseScopeInput({ questionnaireId, revision, expires, shareSignature })) return false;
  if (typeof responseSignature !== "string" || !/^[a-f0-9]{64}$/.test(responseSignature)) return false;
  const expected = Buffer.from(await createQuestionnaireResponseScope({ questionnaireId, revision, expires, shareSignature, secretFile }), "utf8");
  const supplied = Buffer.from(responseSignature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function artifactSignaturePayload(artifactId, version, expires) {
  const scope = version === undefined ? "latest" : `version:${version}`;
  return `artifact-share:${artifactId}:${scope}:${expires}`;
}

export async function createArtifactSignedUrl({
  artifactId,
  version,
  publicBaseUrl,
  secretFile,
  expiresInSeconds = DEFAULT_ARTIFACT_EXPIRY_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!/^[A-Za-z0-9]{24}$/.test(artifactId)) throw new ServiceError(404, "Artifact not found");
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    throw new ServiceError(404, "Artifact version not found");
  }
  const duration = normalizeArtifactExpiry(expiresInSeconds);
  const expires = nowSeconds + duration;
  const secret = await readSharedSecret(secretFile);
  const signature = createHmac("sha256", secret)
    .update(artifactSignaturePayload(artifactId, version, expires), "utf8")
    .digest("hex");
  const pathname = version === undefined
    ? `/artifact/${artifactId}`
    : `/artifact/${artifactId}/versions/${version}`;
  const url = new URL(pathname, `${publicBaseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return {
    artifact_id: artifactId,
    ...(version === undefined ? {} : { version }),
    url: url.toString(),
    expires,
    expires_at: new Date(expires * 1000).toISOString(),
    expires_in_seconds: duration,
  };
}

export async function artifactSignedUrlIsValid({
  artifactId,
  version,
  expires,
  signature,
  secretFile,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!/^[A-Za-z0-9]{24}$/.test(artifactId)) return false;
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return false;
  if (typeof expires !== "string" || !/^\d{10}$/.test(expires)) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < nowSeconds) return false;
  const secret = await readSharedSecret(secretFile);
  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(artifactSignaturePayload(artifactId, version, expiry), "utf8")
      .digest("hex"),
    "utf8",
  );
  const supplied = Buffer.from(signature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function readSharedSecret(secretFile) {
  let secret;
  try {
    secret = (await readFile(secretFile, "utf8")).trim();
  } catch (error) {
    throw new ServiceError(503, "MCP authentication is unavailable", { cause: error });
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new ServiceError(503, "MCP authentication is configured insecurely");
  }
  return secret;
}

export async function bearerIsValid(authorization, secretFile) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const supplied = Buffer.from(authorization.slice(7).trim(), "utf8");
  let expected;
  try {
    expected = Buffer.from(await readSharedSecret(secretFile), "utf8");
  } catch {
    return false;
  }

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function sharedSecretAuth(secretFile) {
  return async (request, response, next) => {
    try {
      if (!(await bearerIsValid(request.get("authorization"), secretFile))) {
        response.set("WWW-Authenticate", 'Bearer realm="personal-mcp-hub"');
        response.set("Cache-Control", "no-store");
        return response.status(401).json({ error: "Unauthorized" });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export async function galleryCsrfToken(artifactId, secretFile) {
  const secret = await readSharedSecret(secretFile);
  return createHmac("sha256", secret).update(`gallery-delete:${artifactId}`, "utf8").digest("hex");
}

export async function galleryCsrfIsValid(artifactId, suppliedToken, secretFile) {
  if (typeof suppliedToken !== "string" || !/^[a-f0-9]{64}$/.test(suppliedToken)) return false;
  const expected = Buffer.from(await galleryCsrfToken(artifactId, secretFile), "utf8");
  const supplied = Buffer.from(suppliedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const QUESTIONNAIRE_ADMIN_ACTIONS = new Set(["sign", "status", "delete", "delete-response"]);

function questionnaireAdminPayload(questionnaireId, action, responseId = "") {
  if (!/^[A-Za-z0-9]{24}$/.test(questionnaireId)) throw new ServiceError(404, "Questionnaire not found");
  if (!QUESTIONNAIRE_ADMIN_ACTIONS.has(action)) throw new ServiceError(400, "Invalid questionnaire action");
  if (action === "delete-response" && !/^[A-Za-z0-9]{24}$/.test(responseId)) throw new ServiceError(404, "Response not found");
  if (action !== "delete-response" && responseId !== "") throw new ServiceError(400, "Invalid questionnaire action");
  return `questionnaire-admin:${action}:${questionnaireId}:${responseId}`;
}

export async function questionnaireAdminCsrfToken(questionnaireId, action, secretFile, responseId = "") {
  const payload = questionnaireAdminPayload(questionnaireId, action, responseId);
  const secret = await readSharedSecret(secretFile);
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export async function questionnaireAdminCsrfIsValid(questionnaireId, action, suppliedToken, secretFile, responseId = "") {
  if (typeof suppliedToken !== "string" || !/^[a-f0-9]{64}$/.test(suppliedToken)) return false;
  let expectedToken;
  try {
    expectedToken = await questionnaireAdminCsrfToken(questionnaireId, action, secretFile, responseId);
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedToken, "utf8");
  const supplied = Buffer.from(suppliedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function createGalleryFlash(artifactId, secretFile, now = Date.now()) {
  if (!/^[A-Za-z0-9]{24}$/.test(artifactId)) throw new ServiceError(400, "Invalid artifact flash message");
  const secret = await readSharedSecret(secretFile);
  const payload = `${artifactId}.${now}`;
  const signature = createHmac("sha256", secret).update(`gallery-flash:${payload}`, "utf8").digest("hex");
  return `${payload}.${signature}`;
}

export async function readGalleryFlash(value, secretFile, now = Date.now(), maxAgeMs = 120_000) {
  if (typeof value !== "string") return "";
  const match = value.match(/^([A-Za-z0-9]{24})\.(\d{13})\.([a-f0-9]{64})$/);
  if (!match) return "";
  const [, artifactId, timestampText, suppliedSignature] = match;
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp > now + 5_000 || now - timestamp > maxAgeMs) return "";
  const secret = await readSharedSecret(secretFile);
  const payload = `${artifactId}.${timestampText}`;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`gallery-flash:${payload}`, "utf8").digest("hex"),
    "utf8",
  );
  const supplied = Buffer.from(suppliedSignature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? artifactId : "";
}

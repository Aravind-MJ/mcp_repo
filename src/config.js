import path from "node:path";

const DEFAULT_RUNTIME_DIR = "/data/mcp-hub";

function positiveInteger(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const runtimeDir = env.MCP_HUB_RUNTIME_DIR || DEFAULT_RUNTIME_DIR;
  const host = env.MCP_HUB_HOST || "127.0.0.1";
  const publicBaseUrl = (env.MCP_HUB_PUBLIC_BASE_URL || "https://mcp.aravindmj.in").replace(/\/+$/, "");
  const publicHost = new URL(publicBaseUrl).host;
  const smtpPort = positiveInteger(env.QUESTIONNAIRE_SMTP_PORT, 587, "QUESTIONNAIRE_SMTP_PORT");

  return Object.freeze({
    host,
    port: positiveInteger(env.MCP_HUB_PORT, 4330, "MCP_HUB_PORT"),
    dataDir: env.MCP_HUB_DATA_DIR || path.join(runtimeDir, "data"),
    secretFile: env.MCP_SHARED_SECRET_FILE || path.join(runtimeDir, "secrets", "shared-secret"),
    openRouterApiKeyFile: env.OPENROUTER_API_KEY_FILE || path.join(runtimeDir, "secrets", "openrouter-api-key"),
    decisionsTimeoutMs: positiveInteger(env.DECISION_OPENROUTER_TIMEOUT_MS, 30_000, "DECISION_OPENROUTER_TIMEOUT_MS"),
    publicBaseUrl,
    maxHtmlBytes: positiveInteger(env.ARTIFACT_MAX_HTML_BYTES, 2 * 1024 * 1024, "ARTIFACT_MAX_HTML_BYTES"),
    maxAttachmentBytes: positiveInteger(env.ARTIFACT_MAX_ATTACHMENT_BYTES, 256 * 1024 * 1024, "ARTIFACT_MAX_ATTACHMENT_BYTES"),
    maxAttachmentsPerArtifact: positiveInteger(env.ARTIFACT_MAX_ATTACHMENTS, 100, "ARTIFACT_MAX_ATTACHMENTS"),
    maxListItems: positiveInteger(env.ARTIFACT_MAX_LIST_ITEMS, 200, "ARTIFACT_MAX_LIST_ITEMS"),
    maxQuestionnaires: positiveInteger(env.QUESTIONNAIRE_MAX_QUESTIONNAIRES ?? env.QUESTIONNAIRE_MAX_ITEMS, 500, "QUESTIONNAIRE_MAX_QUESTIONNAIRES"),
    maxQuestions: positiveInteger(env.QUESTIONNAIRE_MAX_QUESTIONS, 200, "QUESTIONNAIRE_MAX_QUESTIONS"),
    maxRevisionsPerQuestionnaire: positiveInteger(env.QUESTIONNAIRE_MAX_REVISIONS, 100, "QUESTIONNAIRE_MAX_REVISIONS"),
    maxResponsesPerQuestionnaire: positiveInteger(env.QUESTIONNAIRE_MAX_RESPONSES, 10_000, "QUESTIONNAIRE_MAX_RESPONSES"),
    maxAnswerBytes: positiveInteger(env.QUESTIONNAIRE_MAX_ANSWER_BYTES, 256 * 1024, "QUESTIONNAIRE_MAX_ANSWER_BYTES"),
    allowedHosts: [...new Set(["127.0.0.1", "localhost", publicHost])],
    trustProxy: { true: true, false: false }[env.MCP_HUB_TRUST_PROXY] ?? (env.MCP_HUB_TRUST_PROXY || "loopback"),
    questionnaireSmtp: Object.freeze({
      host: env.QUESTIONNAIRE_SMTP_HOST || "",
      port: smtpPort,
      secure: env.QUESTIONNAIRE_SMTP_SECURE === undefined ? smtpPort === 465 : env.QUESTIONNAIRE_SMTP_SECURE === "true",
      requireTLS: true,
      user: env.QUESTIONNAIRE_SMTP_USER || "",
      passwordFile: env.QUESTIONNAIRE_SMTP_PASSWORD_FILE || path.join(runtimeDir, "secrets", "questionnaire-smtp-password"),
      from: env.QUESTIONNAIRE_SMTP_FROM || "",
    }),
  });
}

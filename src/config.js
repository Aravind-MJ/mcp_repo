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

  return Object.freeze({
    host,
    port: positiveInteger(env.MCP_HUB_PORT, 4330, "MCP_HUB_PORT"),
    dataDir: env.MCP_HUB_DATA_DIR || path.join(runtimeDir, "data"),
    secretFile: env.MCP_SHARED_SECRET_FILE || path.join(runtimeDir, "secrets", "shared-secret"),
    publicBaseUrl,
    maxHtmlBytes: positiveInteger(env.ARTIFACT_MAX_HTML_BYTES, 2 * 1024 * 1024, "ARTIFACT_MAX_HTML_BYTES"),
    maxListItems: positiveInteger(env.ARTIFACT_MAX_LIST_ITEMS, 200, "ARTIFACT_MAX_LIST_ITEMS"),
    maxQuestionnaires: positiveInteger(env.QUESTIONNAIRE_MAX_QUESTIONNAIRES ?? env.QUESTIONNAIRE_MAX_ITEMS, 500, "QUESTIONNAIRE_MAX_QUESTIONNAIRES"),
    maxQuestions: positiveInteger(env.QUESTIONNAIRE_MAX_QUESTIONS, 200, "QUESTIONNAIRE_MAX_QUESTIONS"),
    maxRevisionsPerQuestionnaire: positiveInteger(env.QUESTIONNAIRE_MAX_REVISIONS, 100, "QUESTIONNAIRE_MAX_REVISIONS"),
    maxResponsesPerQuestionnaire: positiveInteger(env.QUESTIONNAIRE_MAX_RESPONSES, 10_000, "QUESTIONNAIRE_MAX_RESPONSES"),
    maxAnswerBytes: positiveInteger(env.QUESTIONNAIRE_MAX_ANSWER_BYTES, 256 * 1024, "QUESTIONNAIRE_MAX_ANSWER_BYTES"),
    allowedHosts: [...new Set(["127.0.0.1", "localhost", publicHost])],
  });
}

import { readFile } from "node:fs/promises";

export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";
export const LATEST_JEV_MODEL = "~typesafe/jev-latest";

export async function readOpenRouterApiKey(apiKeyFile) {
  let key;
  try {
    key = (await readFile(apiKeyFile, "utf8")).trim();
  } catch (error) {
    throw new Error("OpenRouter authentication is unavailable", { cause: error });
  }
  if (!key || Buffer.byteLength(key, "utf8") > 4096) {
    throw new Error("OpenRouter authentication is configured incorrectly");
  }
  return key;
}

export async function openRouterApiKeyAvailable(apiKeyFile) {
  try {
    await readOpenRouterApiKey(apiKeyFile);
    return true;
  } catch {
    return false;
  }
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validDistribution(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key) && probability(value[key]));
}

function validAnswer(answer, question) {
  if (!isPlainObject(answer) || answer.type !== question.type) return false;
  if (question.type === "noul") return probability(answer.noul);
  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    return options.includes(answer.choice)
      && (answer.confidence === undefined || probability(answer.confidence))
      && validDistribution(answer.probabilities, options);
  }
  const indexes = question.criteria.map((_, index) => String(index));
  return typeof answer.score === "number"
    && Number.isFinite(answer.score)
    && answer.score >= 0
    && answer.score <= question.criteria.length - 1
    && (answer.confidence === undefined || probability(answer.confidence))
    && validDistribution(answer.probabilities, indexes);
}

function validatePayload(payload, questions) {
  if (!isPlainObject(payload) || !isPlainObject(payload.answers)) return false;
  const expectedIds = Object.keys(questions);
  const answerIds = Object.keys(payload.answers);
  return answerIds.length === expectedIds.length
    && expectedIds.every((id) => Object.hasOwn(payload.answers, id) && validAnswer(payload.answers[id], questions[id]));
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("OpenRouter Decisions response exceeded the size limit");
  }
  if (!response.body) throw new Error("OpenRouter Decisions returned an empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("OpenRouter Decisions response exceeded the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(joined));
  } catch (error) {
    if (error.message.includes("size limit")) throw error;
    throw new Error("OpenRouter Decisions returned an invalid JSON response", { cause: error });
  }
}

export class JevClient {
  constructor({ apiKeyFile, timeoutMs = 30_000, fetchFn } = {}) {
    this.apiKeyFile = apiKeyFile;
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  async makeDecisions({ state, questions, model = DEFAULT_JEV_MODEL }) {
    const apiKey = await readOpenRouterApiKey(this.apiKeyFile);
    let response;
    try {
      response = await this.fetchFn(OPENROUTER_DECISIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, state, questions }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError") throw new Error("OpenRouter Decisions request timed out");
      throw new Error("OpenRouter Decisions request could not be completed", { cause: error });
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`OpenRouter Decisions request failed with HTTP ${response.status}`);
    }

    const payload = await readBoundedJson(response);
    if (!validatePayload(payload, questions)) {
      throw new Error("OpenRouter Decisions returned an invalid response");
    }
    return payload;
  }
}

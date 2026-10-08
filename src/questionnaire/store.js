import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ServiceError } from "../errors.js";
import { createQuestionnaireSignedUrl } from "../security.js";
import { createSmtpMailer } from "./mailer.js";

export const QUESTIONNAIRE_ID_PATTERN = /^[A-Za-z0-9]{24}$/;
const MAX_QUESTION_NESTING_DEPTH = 8;
const CONDITIONAL_PARENT_TYPES = new Set(["single_choice", "multiple_choice", "dropdown", "yes_no", "consent", "rating", "scale"]);
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const QUESTION_TYPES = Object.freeze([
  "short_text", "long_text", "email", "url", "phone", "number", "date", "time", "datetime",
  "single_choice", "multiple_choice", "dropdown", "yes_no", "consent", "rating", "scale", "ranking", "matrix",
]);
const QUESTION_TYPE_SET = new Set(QUESTION_TYPES);
const OPTION_TYPES = new Set(["single_choice", "multiple_choice", "dropdown", "ranking", "matrix"]);
const TEXT_TYPES = new Set(["short_text", "long_text", "email", "url", "phone"]);
export const AUTHENTICATION_TYPES = Object.freeze(["anonymous", "self_report", "email_verified"]);
export const EMAIL_VERIFICATION_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60_000,
  proofTtlMs: 30 * 60_000,
  maxFailedAttempts: 5,
  resendCooldownMs: 60_000,
  sendsPerEmailPerQuestionnairePerHour: 5,
  sendsPerSourcePerHour: 20,
});
const HOUR_MS = 60 * 60_000;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesMatch(expectedHex, actualHex) {
  if (typeof expectedHex !== "string" || typeof actualHex !== "string" || expectedHex.length !== actualHex.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(actualHex, "hex"));
}

function serviceError(message, status = 400) {
  return new ServiceError(status, message);
}

export function generateQuestionnaireId(length = 24) {
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(Math.max(16, length - result.length))) {
      if (byte >= 248) continue;
      result += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function cleanText(value, name, max, { required = false, fallback = "" } = {}) {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== "string") throw serviceError(`${name} must be a string`);
  const cleaned = value.trim().replace(/\r\n?/g, "\n");
  if (required && !cleaned) throw serviceError(`${name} is required`);
  if (cleaned.length > max) throw serviceError(`${name} must be at most ${max} characters`);
  return cleaned;
}

function cleanSingleLine(value, name, max, options = {}) {
  return cleanText(value, name, max, options).replace(/\s+/g, " ");
}

// Exactly one bare addr-spec: a dot-atom local part and a DNS host name. Quoted strings, comments,
// display names, groups, address literals, and separators are rejected so that SMTP libraries cannot
// read the value as a different or additional recipient.
export const RESPONDENT_EMAIL_PATTERN = /^(?=[^@]{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?=.{4,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function normalizeRespondent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw serviceError("respondent name and email are required");
  const name = cleanSingleLine(raw.name, "respondent name", 160, { required: true });
  const email = cleanSingleLine(raw.email, "respondent email", 320, { required: true });
  if (!RESPONDENT_EMAIL_PATTERN.test(email)) throw serviceError("respondent email must be a valid email address");
  const at = email.lastIndexOf("@");
  return { name, email: `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}` };
}

function normalizeAuthenticationType(value, fallback) {
  if (value === undefined) return fallback;
  if (!AUTHENTICATION_TYPES.includes(value)) throw serviceError(`authentication_type must be one of ${AUTHENTICATION_TYPES.join(", ")}`);
  return value;
}

function identityStatus(row, authenticationType) {
  if (row.status !== "submitted") return "pending";
  if (authenticationType === "anonymous") return "anonymous";
  if (row.email_verified_at) return "email_verified";
  if (row.respondent_name && row.respondent_email) return "self_reported";
  return "legacy_missing";
}

function cleanBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw serviceError("Boolean setting expected");
  return value;
}

function cleanInteger(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw serviceError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeOptions(raw, questionId, name = "options", minimum = 2, maximum = 100) {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > maximum) {
    throw serviceError(`${questionId} ${name} must contain between ${minimum} and ${maximum} items`);
  }
  const seen = new Set();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw serviceError(`${questionId} ${name}[${index}] must be an object`);
    const value = cleanSingleLine(item.value, `${questionId} ${name}[${index}].value`, 80, { required: true });
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)) throw serviceError(`${questionId} option values may use letters, numbers, dot, dash, and underscore`);
    if (seen.has(value)) throw serviceError(`${questionId} option values must be unique`);
    seen.add(value);
    return {
      value,
      label: cleanSingleLine(item.label, `${questionId} ${name}[${index}].label`, 160, { required: true }),
      ...(item.description ? { description: cleanText(item.description, `${questionId} ${name}[${index}].description`, 300) } : {}),
    };
  });
}

function normalizeValidation(raw = {}, type) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw serviceError("validation must be an object");
  const result = {};
  if (TEXT_TYPES.has(type)) {
    if (raw.min_length !== undefined) result.min_length = cleanInteger(raw.min_length, "min_length", 0, 100_000);
    if (raw.max_length !== undefined) result.max_length = cleanInteger(raw.max_length, "max_length", 1, 100_000);
    if (result.min_length !== undefined && result.max_length !== undefined && result.min_length > result.max_length) {
      throw serviceError("min_length cannot exceed max_length");
    }
  }
  if (type === "number") {
    for (const key of ["min", "max", "step"]) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== "number" || !Number.isFinite(raw[key])) throw serviceError(`${key} must be a finite number`);
        result[key] = raw[key];
      }
    }
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) throw serviceError("min cannot exceed max");
    if (result.step !== undefined && result.step <= 0) throw serviceError("step must be greater than zero");
  }
  if (type === "multiple_choice") {
    if (raw.min_selections !== undefined) result.min_selections = cleanInteger(raw.min_selections, "min_selections", 0, 100);
    if (raw.max_selections !== undefined) result.max_selections = cleanInteger(raw.max_selections, "max_selections", 1, 100);
    if (result.min_selections !== undefined && result.max_selections !== undefined && result.min_selections > result.max_selections) {
      throw serviceError("min_selections cannot exceed max_selections");
    }
  }
  return result;
}

function conditionKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function availableConditionValues(parent) {
  if (["single_choice", "multiple_choice", "dropdown"].includes(parent.type)) return parent.options.map((option) => option.value);
  if (parent.type === "yes_no") return ["yes", "no"];
  if (parent.type === "consent") return [true, false];
  if (parent.type === "rating") return Array.from({ length: parent.settings.max }, (_, index) => index + 1);
  if (parent.type === "scale") return Array.from({ length: parent.settings.max - parent.settings.min + 1 }, (_, index) => parent.settings.min + index);
  return [];
}

function normalizeShowWhen(raw, questionId, parent) {
  if (!parent) throw serviceError(`${questionId}.show_when is only valid on a nested question`);
  if (!CONDITIONAL_PARENT_TYPES.has(parent.type)) throw serviceError(`${questionId}.show_when requires a choice, yes/no, consent, rating, or scale parent`);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw serviceError(`${questionId}.show_when must contain between 1 and 100 parent answer values`);
  const available = new Set(availableConditionValues(parent).map(conditionKey));
  const seen = new Set();
  return raw.map((value) => {
    if (!(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
      throw serviceError(`${questionId}.show_when values must be strings, booleans, or finite numbers`);
    }
    const key = conditionKey(value);
    if (seen.has(key)) throw serviceError(`${questionId}.show_when values must be unique`);
    if (!available.has(key)) throw serviceError(`${questionId}.show_when must use an available parent answer`);
    seen.add(key);
    return value;
  });
}

function normalizeQuestion(question, path, parent, depth, state) {
  if (depth > MAX_QUESTION_NESTING_DEPTH) throw serviceError(`Question nesting cannot exceed ${MAX_QUESTION_NESTING_DEPTH} levels`);
  if (!question || typeof question !== "object" || Array.isArray(question)) throw serviceError(`${path} must be an object`);
  const id = cleanSingleLine(question.id, `${path}.id`, 64, { required: true });
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw serviceError(`Question ID ${id} must start with a letter and contain only letters, numbers, dash, or underscore`);
  if (state.ids.has(id)) throw serviceError("Question IDs must be unique across every nesting level");
  state.ids.add(id);
  state.count += 1;
  if (state.count > state.maxQuestions) throw serviceError(`questions must contain between 1 and ${state.maxQuestions} items across all nesting levels`);
  const type = cleanSingleLine(question.type, `${id}.type`, 40, { required: true });
  if (!QUESTION_TYPE_SET.has(type)) throw serviceError(`Unsupported question type: ${type}`);
  const normalized = {
    id,
    type,
    title: cleanSingleLine(question.title, `${id}.title`, 300, { required: true }),
    required: cleanBoolean(question.required, false),
  };
  if (question.description) normalized.description = cleanText(question.description, `${id}.description`, 1_000);
  if (question.placeholder && TEXT_TYPES.has(type)) normalized.placeholder = cleanSingleLine(question.placeholder, `${id}.placeholder`, 200);
  const validation = normalizeValidation(question.validation, type);
  if (Object.keys(validation).length) normalized.validation = validation;
  if (OPTION_TYPES.has(type)) {
    const maximum = type === "ranking" ? 30 : type === "matrix" ? 12 : 100;
    normalized.options = normalizeOptions(question.options, id, "options", 2, maximum);
  }
  if (type === "multiple_choice") {
    if (validation.min_selections !== undefined && validation.min_selections > normalized.options.length) {
      throw serviceError(`${id} min_selections cannot exceed the number of available options`);
    }
    if (validation.max_selections !== undefined && validation.max_selections > normalized.options.length) {
      throw serviceError(`${id} max_selections cannot exceed the number of available options`);
    }
  }
  if (type === "matrix") normalized.rows = normalizeOptions(question.rows, id, "rows", 1, 30);
  if (type === "rating") {
    const settings = question.settings || {};
    normalized.settings = {
      max: cleanInteger(settings.max, `${id}.settings.max`, 3, 10, 5),
      icon: ["star", "heart", "number"].includes(settings.icon) ? settings.icon : "star",
    };
  }
  if (type === "scale") {
    const settings = question.settings || {};
    const min = cleanInteger(settings.min, `${id}.settings.min`, -10, 100, 0);
    const max = cleanInteger(settings.max, `${id}.settings.max`, -9, 100, 10);
    if (max <= min || max - min > 20) throw serviceError(`${id} scale must have 1–20 steps with max greater than min`);
    normalized.settings = {
      min,
      max,
      min_label: cleanSingleLine(settings.min_label, `${id}.settings.min_label`, 100),
      max_label: cleanSingleLine(settings.max_label, `${id}.settings.max_label`, 100),
    };
  }
  if (question.show_when !== undefined) normalized.show_when = normalizeShowWhen(question.show_when, id, parent);
  if (question.children !== undefined) {
    if (!Array.isArray(question.children) || question.children.length < 1) throw serviceError(`${id}.children must contain at least one question`);
    normalized.children = question.children.map((child, index) => normalizeQuestion(child, `${path}.children[${index}]`, normalized, depth + 1, state));
  }
  return normalized;
}

export function normalizeQuestions(raw, maxQuestions = 200) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxQuestions) {
    throw serviceError(`questions must contain between 1 and ${maxQuestions} items`);
  }
  const state = { count: 0, ids: new Set(), maxQuestions };
  return raw.map((question, index) => normalizeQuestion(question, `questions[${index}]`, null, 1, state));
}

function normalizeSettings(raw = {}, previous = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw serviceError("settings must be an object");
  const accent = raw.accent_color === undefined
    ? (previous?.accent_color ?? "#6d5dfc")
    : cleanSingleLine(raw.accent_color, "accent_color", 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw serviceError("accent_color must be a six-digit hex color");
  return {
    submit_label: cleanSingleLine(raw.submit_label, "submit_label", 60, { fallback: previous?.submit_label ?? "Submit response" }) || "Submit response",
    completion_message: cleanText(raw.completion_message, "completion_message", 1_000, { fallback: previous?.completion_message ?? "Thank you—your response has been recorded." }) || "Thank you—your response has been recorded.",
    accent_color: accent.toLowerCase(),
    show_progress: cleanBoolean(raw.show_progress, previous?.show_progress ?? true),
  };
}

function parseJson(value) {
  return JSON.parse(value);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0) || (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function optionValues(question) {
  return new Set((question.options || []).map((option) => option.value));
}

function answerError(question, message) {
  throw serviceError(`${question.id}: ${message}`);
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateDateTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [date, time] = value.split("T");
  return validateDate(date) && validateTime(time);
}

function validateOneAnswer(question, value, { final = false } = {}) {
  if (isBlank(value)) return value;
  const validation = question.validation || {};
  if (TEXT_TYPES.has(question.type)) {
    if (typeof value !== "string") answerError(question, "answer must be text");
    const cleaned = value.replace(/\r\n?/g, "\n");
    if (final && validation.min_length !== undefined && cleaned.length < validation.min_length) answerError(question, `answer must contain at least ${validation.min_length} characters`);
    if (validation.max_length !== undefined && cleaned.length > validation.max_length) answerError(question, `answer must contain at most ${validation.max_length} characters`);
    if (final && question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) answerError(question, "answer must be a valid email address");
    if (final && question.type === "url") {
      try {
        const parsed = new URL(cleaned);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { answerError(question, "answer must be a valid http(s) URL"); }
    }
    if (final && question.type === "phone" && (!/^[+()\d\s.-]{5,40}$/.test(cleaned) || !/\d/.test(cleaned))) answerError(question, "answer must be a valid phone number");
    return cleaned;
  }
  if (question.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) answerError(question, "answer must be a number");
    if (final && validation.min !== undefined && value < validation.min) answerError(question, `answer must be at least ${validation.min}`);
    if (final && validation.max !== undefined && value > validation.max) answerError(question, `answer must be at most ${validation.max}`);
    if (final && validation.step !== undefined) {
      const ratio = (value - (validation.min ?? 0)) / validation.step;
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8;
      if (Math.abs(ratio - Math.round(ratio)) > tolerance) answerError(question, `answer must follow a step of ${validation.step}`);
    }
    return value;
  }
  if (question.type === "date") {
    if (typeof value !== "string" || !validateDate(value)) answerError(question, "answer must be a valid date");
    return value;
  }
  if (question.type === "time") {
    if (typeof value !== "string" || !validateTime(value)) answerError(question, "answer must be a valid time");
    return value;
  }
  if (question.type === "datetime") {
    if (!validateDateTime(value)) answerError(question, "answer must be a valid date and time");
    return value;
  }
  if (["single_choice", "dropdown"].includes(question.type)) {
    if (typeof value !== "string" || !optionValues(question).has(value)) answerError(question, "answer must be one of the available options");
    return value;
  }
  if (question.type === "yes_no") {
    if (!["yes", "no"].includes(value)) answerError(question, "answer must be yes or no");
    return value;
  }
  if (question.type === "consent") {
    if (typeof value !== "boolean") answerError(question, "answer must be true or false");
    return value;
  }
  if (question.type === "multiple_choice") {
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((item) => typeof item !== "string" || !optionValues(question).has(item))) answerError(question, "answer contains an unavailable option");
    if (final && validation.min_selections !== undefined && value.length < validation.min_selections) answerError(question, `select at least ${validation.min_selections}`);
    if (validation.max_selections !== undefined && value.length > validation.max_selections) answerError(question, `select no more than ${validation.max_selections}`);
    return value;
  }
  if (question.type === "rating") {
    const max = question.settings.max;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) answerError(question, `answer must be an integer from 1 to ${max}`);
    return value;
  }
  if (question.type === "scale") {
    const { min, max } = question.settings;
    if (!Number.isSafeInteger(value) || value < min || value > max) answerError(question, `answer must be an integer from ${min} to ${max}`);
    return value;
  }
  if (question.type === "ranking") {
    const available = optionValues(question);
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((item) => !available.has(item))) answerError(question, "ranking contains an unavailable or duplicate option");
    return value;
  }
  if (question.type === "matrix") {
    if (!value || typeof value !== "object" || Array.isArray(value)) answerError(question, "answer must be a row-to-option object");
    const rows = new Set(question.rows.map((row) => row.value));
    const options = optionValues(question);
    for (const [row, selected] of Object.entries(value)) {
      if (!rows.has(row) || !options.has(selected)) answerError(question, "matrix contains an unavailable row or option");
    }
    return { ...value };
  }
  answerError(question, "unsupported answer type");
}

export function validateAnswers(questions, raw, { final = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw serviceError("answers must be an object");
  const allQuestions = [];
  const collect = (items) => {
    for (const question of items) {
      allQuestions.push(question);
      if (question.children) collect(question.children);
    }
  };
  collect(questions);
  const byId = new Map(allQuestions.map((question) => [question.id, question]));
  for (const key of Object.keys(raw)) if (!byId.has(key)) throw serviceError(`Unknown question: ${key}`);
  const answers = {};
  const conditionMatches = (expected, value) => Array.isArray(value)
    ? value.some((item) => expected.some((candidate) => Object.is(candidate, item)))
    : expected.some((candidate) => Object.is(candidate, value));
  const visit = (items, parentActive = true, parentValue) => {
    for (const question of items) {
      const active = parentActive && (question.show_when === undefined || conditionMatches(question.show_when, parentValue));
      if (!active) continue;
      const value = raw[question.id];
      if (final && question.required) {
        if (isBlank(value) || (question.type === "consent" && value !== true)) answerError(question, "an answer is required");
        if (question.type === "ranking" && value.length !== question.options.length) answerError(question, "rank every option");
        if (question.type === "matrix" && Object.keys(value).length !== question.rows.length) answerError(question, "answer every row");
      }
      if (value !== undefined) answers[question.id] = validateOneAnswer(question, value, { final });
      if (question.children) visit(question.children, active, answers[question.id]);
    }
  };
  visit(questions);
  return answers;
}

const RESPONSE_SELECT = `SELECT r.*, v.authentication_type FROM responses r
  JOIN questionnaire_revisions v ON v.questionnaire_id = r.questionnaire_id AND v.revision = r.revision`;

export class QuestionnaireStore {
  constructor(config) {
    this.config = {
      ...config,
      maxQuestionnaires: config.maxQuestionnaires ?? 500,
      maxQuestions: config.maxQuestions ?? 200,
      maxRevisionsPerQuestionnaire: config.maxRevisionsPerQuestionnaire ?? 100,
      maxResponsesPerQuestionnaire: config.maxResponsesPerQuestionnaire ?? 10_000,
      maxAnswerBytes: config.maxAnswerBytes ?? 256 * 1024,
    };
    this.databasePath = path.join(config.dataDir, "questionnaire", "questionnaires.sqlite3");
    this.clock = config.clock ?? Date.now;
    this.mailer = config.questionnaireMailer ?? createSmtpMailer(config.questionnaireSmtp);
    this.db = null;
  }

  async initialize() {
    await mkdir(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.databasePath), 0o700);
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    await chmod(this.databasePath, 0o600);
    await Promise.all([
      chmod(`${this.databasePath}-wal`, 0o600).catch(() => {}),
      chmod(`${this.databasePath}-shm`, 0o600).catch(() => {}),
    ]);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS questionnaires (
        id TEXT PRIMARY KEY CHECK(length(id) = 24),
        status TEXT NOT NULL CHECK(status IN ('open','closed')) DEFAULT 'open',
        current_revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS questionnaire_revisions (
        questionnaire_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        authentication_type TEXT NOT NULL CHECK(authentication_type IN ('anonymous','self_report','email_verified')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(questionnaire_id, revision),
        FOREIGN KEY(questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY CHECK(length(id) = 24),
        questionnaire_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        edit_token_hash TEXT NOT NULL CHECK(length(edit_token_hash) = 64),
        status TEXT NOT NULL CHECK(status IN ('draft','submitted')) DEFAULT 'draft',
        answers_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        submitted_at TEXT,
        respondent_name TEXT,
        respondent_email TEXT,
        email_verified_at TEXT,
        channel TEXT NOT NULL DEFAULT 'browser' CHECK(channel IN ('browser','mcp')),
        FOREIGN KEY(questionnaire_id, revision) REFERENCES questionnaire_revisions(questionnaire_id, revision) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS responses_questionnaire_idx ON responses(questionnaire_id, revision, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS questionnaire_email_verifications (
        response_id TEXT PRIMARY KEY,
        questionnaire_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        email TEXT NOT NULL,
        code_salt TEXT,
        code_hash TEXT,
        code_expires_at INTEGER,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        last_sent_at INTEGER NOT NULL,
        proof_hash TEXT,
        proof_expires_at INTEGER,
        verified_at INTEGER,
        FOREIGN KEY(response_id) REFERENCES responses(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS questionnaire_email_sends (
        id INTEGER PRIMARY KEY,
        questionnaire_id TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        sent_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS questionnaire_email_sends_email_idx ON questionnaire_email_sends(questionnaire_id, email_hash, sent_at);
      CREATE INDEX IF NOT EXISTS questionnaire_email_sends_source_idx ON questionnaire_email_sends(source_hash, sent_at);
    `);
    // Revisions created before authentication modes existed collected name and email, so they become self_report.
    const revisionColumns = this.db.prepare("PRAGMA table_info(questionnaire_revisions)").all();
    if (!revisionColumns.some((column) => column.name === "authentication_type")) {
      this.db.exec("ALTER TABLE questionnaire_revisions ADD COLUMN authentication_type TEXT NOT NULL DEFAULT 'self_report' CHECK(authentication_type IN ('anonymous','self_report','email_verified'))");
    }
    const responseColumns = this.db.prepare("PRAGMA table_info(responses)").all();
    if (!responseColumns.some((column) => column.name === "version")) {
      this.db.exec("ALTER TABLE responses ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)");
    }
    if (!responseColumns.some((column) => column.name === "respondent_name")) {
      this.db.exec("ALTER TABLE responses ADD COLUMN respondent_name TEXT");
    }
    if (!responseColumns.some((column) => column.name === "respondent_email")) {
      this.db.exec("ALTER TABLE responses ADD COLUMN respondent_email TEXT");
    }
    if (!responseColumns.some((column) => column.name === "email_verified_at")) {
      this.db.exec("ALTER TABLE responses ADD COLUMN email_verified_at TEXT");
    }
    if (!responseColumns.some((column) => column.name === "channel")) {
      this.db.exec("ALTER TABLE responses ADD COLUMN channel TEXT NOT NULL DEFAULT 'browser' CHECK(channel IN ('browser','mcp'))");
    }
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  validateId(id, entity = "Questionnaire") {
    if (typeof id !== "string" || !QUESTIONNAIRE_ID_PATTERN.test(id)) throw serviceError(`${entity} not found`, 404);
    return id;
  }

  validateRevision(revision) {
    const parsed = typeof revision === "number" ? revision : Number.parseInt(revision, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== String(revision)) throw serviceError("Questionnaire revision not found", 404);
    return parsed;
  }

  allocateId(table) {
    const statement = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = generateQuestionnaireId();
      if (!statement.get(id)) return id;
    }
    throw serviceError("Could not allocate an ID", 500);
  }

  normalizeDefinition(input, previous = null) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw serviceError("Questionnaire must be an object");
    return {
      title: input.title === undefined && previous ? previous.title : cleanSingleLine(input.title, "title", 160, { required: true }),
      description: input.description === undefined && previous ? previous.description : cleanText(input.description, "description", 4_000),
      questions: input.questions === undefined && previous ? previous.questions : normalizeQuestions(input.questions, this.config.maxQuestions),
      settings: input.settings === undefined && previous ? previous.settings : normalizeSettings(input.settings, previous?.settings),
      authentication_type: normalizeAuthenticationType(input.authentication_type, previous?.authentication_type ?? "anonymous"),
    };
  }

  create(input) {
    const definition = this.normalizeDefinition(input);
    const count = Number(this.db.prepare("SELECT count(*) AS count FROM questionnaires").get().count);
    if (count >= this.config.maxQuestionnaires) throw serviceError("Questionnaire limit reached", 409);
    const id = this.allocateId("questionnaires");
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO questionnaires (id, status, current_revision, created_at, updated_at) VALUES (?, 'open', 1, ?, ?)").run(id, now, now);
      this.db.prepare("INSERT INTO questionnaire_revisions (questionnaire_id, revision, title, description, questions_json, settings_json, authentication_type, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)")
        .run(id, definition.title, definition.description, JSON.stringify(definition.questions), JSON.stringify(definition.settings), definition.authentication_type, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(id, 1);
  }

  update(id, input) {
    const questionnaireId = this.validateId(id);
    const current = this.get(questionnaireId);
    if (current.revision >= this.config.maxRevisionsPerQuestionnaire) {
      throw serviceError("This questionnaire has reached its revision limit", 409);
    }
    const definition = this.normalizeDefinition(input, current);
    const revision = current.revision + 1;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO questionnaire_revisions (questionnaire_id, revision, title, description, questions_json, settings_json, authentication_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(questionnaireId, revision, definition.title, definition.description, JSON.stringify(definition.questions), JSON.stringify(definition.settings), definition.authentication_type, now);
      this.db.prepare("UPDATE questionnaires SET current_revision = ?, updated_at = ? WHERE id = ?").run(revision, now, questionnaireId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(questionnaireId, revision);
  }

  get(id, revision) {
    const questionnaireId = this.validateId(id);
    const selectedRevision = revision === undefined ? undefined : this.validateRevision(revision);
    const row = selectedRevision === undefined
      ? this.db.prepare(`SELECT q.id, q.status, q.current_revision AS revision, q.created_at, q.updated_at,
          r.title, r.description, r.questions_json, r.settings_json, r.authentication_type, r.created_at AS revision_created_at
          FROM questionnaires q JOIN questionnaire_revisions r ON r.questionnaire_id = q.id AND r.revision = q.current_revision WHERE q.id = ?`).get(questionnaireId)
      : this.db.prepare(`SELECT q.id, q.status, r.revision, q.created_at, q.updated_at,
          r.title, r.description, r.questions_json, r.settings_json, r.authentication_type, r.created_at AS revision_created_at
          FROM questionnaires q JOIN questionnaire_revisions r ON r.questionnaire_id = q.id WHERE q.id = ? AND r.revision = ?`).get(questionnaireId, selectedRevision);
    if (!row) throw serviceError(selectedRevision === undefined ? "Questionnaire not found" : "Questionnaire revision not found", 404);
    const stats = this.db.prepare("SELECT count(*) AS total, sum(status = 'draft') AS drafts, sum(status = 'submitted') AS submitted FROM responses WHERE questionnaire_id = ? AND revision = ?").get(questionnaireId, row.revision);
    return {
      questionnaire_id: row.id,
      revision: Number(row.revision),
      status: row.status,
      title: row.title,
      description: row.description,
      questions: parseJson(row.questions_json),
      settings: parseJson(row.settings_json),
      authentication_type: row.authentication_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
      revision_created_at: row.revision_created_at,
      response_counts: { total: Number(stats.total || 0), drafts: Number(stats.drafts || 0), submitted: Number(stats.submitted || 0) },
    };
  }

  list({ limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 50, 200));
    const safeOffset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0);
    const rows = this.db.prepare(`SELECT q.id FROM questionnaires q ORDER BY q.updated_at DESC LIMIT ? OFFSET ?`).all(safeLimit, safeOffset);
    const total = Number(this.db.prepare("SELECT count(*) AS count FROM questionnaires").get().count);
    return { questionnaires: rows.map((row) => this.get(row.id)), total, limit: safeLimit, offset: safeOffset, has_more: safeOffset + rows.length < total };
  }

  setStatus(id, status) {
    const questionnaireId = this.validateId(id);
    if (!["open", "closed"].includes(status)) throw serviceError("status must be open or closed");
    const current = this.get(questionnaireId);
    if (current.status === status) return current;
    const now = new Date().toISOString();
    const result = this.db.prepare("UPDATE questionnaires SET status = ?, updated_at = ? WHERE id = ?").run(status, now, questionnaireId);
    if (!result.changes) throw serviceError("Questionnaire not found", 404);
    return this.get(questionnaireId);
  }

  async createSignedUrl(id, expiresInSeconds, revision) {
    const questionnaire = this.get(id, revision);
    return createQuestionnaireSignedUrl({
      questionnaireId: questionnaire.questionnaire_id,
      revision,
      publicBaseUrl: this.config.publicBaseUrl,
      secretFile: this.config.secretFile,
      ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
    });
  }

  delete(id) {
    const questionnaireId = this.validateId(id);
    const current = this.get(questionnaireId);
    this.db.prepare("DELETE FROM questionnaires WHERE id = ?").run(questionnaireId);
    return current;
  }

  createResponse(id, revision, { channel = "browser" } = {}) {
    const questionnaire = this.get(id, revision);
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM responses WHERE questionnaire_id = ?").get(questionnaire.questionnaire_id).total;
    if (count >= this.config.maxResponsesPerQuestionnaire) {
      throw serviceError("This questionnaire has reached its response limit", 409);
    }
    const responseId = this.allocateId("responses");
    const editToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(editToken);
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO responses (id, questionnaire_id, revision, edit_token_hash, status, answers_json, version, channel, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', '{}', 0, ?, ?, ?)")
      .run(responseId, questionnaire.questionnaire_id, questionnaire.revision, tokenHash, channel, now, now);
    return { response_id: responseId, edit_token: editToken, status: "draft", answers: {}, respondent: null, version: 0, created_at: now, updated_at: now, submitted_at: null };
  }

  responseRow(id, revision, responseId, editToken) {
    const questionnaireId = this.validateId(id);
    const selectedRevision = this.validateRevision(revision);
    const validatedResponseId = this.validateId(responseId, "Response");
    if (typeof editToken !== "string" || !/^[a-f0-9]{64}$/.test(editToken)) throw serviceError("Response not found", 404);
    const row = this.db.prepare(`${RESPONSE_SELECT} WHERE r.id = ? AND r.questionnaire_id = ? AND r.revision = ? AND r.edit_token_hash = ?`)
      .get(validatedResponseId, questionnaireId, selectedRevision, sha256(editToken));
    if (!row) throw serviceError("Response not found", 404);
    return row;
  }

  mcpResponseRow(id, responseId) {
    const questionnaireId = this.validateId(id);
    const validatedResponseId = this.validateId(responseId, "Response");
    const row = this.db.prepare(`${RESPONSE_SELECT} WHERE r.id = ? AND r.questionnaire_id = ? AND r.channel = 'mcp'`).get(validatedResponseId, questionnaireId);
    if (!row) throw serviceError("Response not found", 404);
    return row;
  }

  responseSummary(row) {
    return {
      response_id: row.id,
      questionnaire_id: row.questionnaire_id,
      revision: Number(row.revision),
      status: row.status,
      authentication_type: row.authentication_type,
      identity_status: identityStatus(row, row.authentication_type),
      respondent: row.respondent_name && row.respondent_email
        ? { name: row.respondent_name, email: row.respondent_email }
        : null,
      email_verified_at: row.email_verified_at ?? null,
      version: Number(row.version),
      created_at: row.created_at,
      updated_at: row.updated_at,
      submitted_at: row.submitted_at,
    };
  }

  publicResponse(row) {
    const { version, created_at, updated_at, submitted_at, ...summary } = this.responseSummary(row);
    return { ...summary, answers: parseJson(row.answers_json), version, created_at, updated_at, submitted_at };
  }

  getResponseForEdit(id, revision, responseId, editToken) {
    return this.publicResponse(this.responseRow(id, revision, responseId, editToken));
  }

  saveResponse(id, revision, responseId, editToken, answers, expectedVersion) {
    const questionnaire = this.get(id, revision);
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    const row = this.responseRow(id, revision, responseId, editToken);
    if (row.status === "submitted") throw serviceError("This response is already submitted", 409);
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) throw serviceError("version must be a non-negative integer");
    if (expectedVersion !== undefined && expectedVersion !== Number(row.version)) throw serviceError("This response changed in another tab; reload before continuing", 409);
    const validated = validateAnswers(questionnaire.questions, answers);
    const encoded = JSON.stringify(validated);
    if (Buffer.byteLength(encoded, "utf8") > this.config.maxAnswerBytes) throw serviceError("Answers exceed the storage limit", 413);
    const now = new Date().toISOString();
    this.db.prepare("UPDATE responses SET answers_json = ?, version = version + 1, updated_at = ? WHERE id = ?").run(encoded, now, row.id);
    return this.getResponseForEdit(id, revision, responseId, editToken);
  }

  identityFor(questionnaire, respondent) {
    if (questionnaire.authentication_type === "anonymous") {
      if (respondent !== undefined && respondent !== null) throw serviceError("This questionnaire is anonymous; respondent name and email are not accepted");
      return null;
    }
    return normalizeRespondent(respondent);
  }

  // Validates and finalizes a draft. For email_verified, the proof is consumed in the same transaction.
  finalizeResponse(questionnaire, row, answers, respondent, expectedVersion, verificationProof) {
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    if (row.status === "submitted") throw serviceError("This response is already submitted", 409);
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) throw serviceError("version must be a non-negative integer");
    if (expectedVersion !== undefined && expectedVersion !== Number(row.version)) throw serviceError("This response changed in another tab; reload before continuing", 409);
    const validated = validateAnswers(questionnaire.questions, answers, { final: true });
    const identity = this.identityFor(questionnaire, respondent);
    const encoded = JSON.stringify(validated);
    if (Buffer.byteLength(encoded, "utf8") > this.config.maxAnswerBytes) throw serviceError("Answers exceed the storage limit", 413);
    const verified = questionnaire.authentication_type === "email_verified";
    let verifiedAt = null;
    let proofHash = null;
    if (verified) {
      const challenge = this.db.prepare("SELECT * FROM questionnaire_email_verifications WHERE response_id = ?").get(row.id);
      proofHash = typeof verificationProof === "string" && /^[a-f0-9]{64}$/.test(verificationProof) ? sha256(verificationProof) : null;
      if (!challenge || !proofHash || !hashesMatch(challenge.proof_hash, proofHash)
        || challenge.questionnaire_id !== row.questionnaire_id || Number(challenge.revision) !== Number(row.revision)) {
        throw serviceError("Email verification is required before submitting", 403);
      }
      if (challenge.email !== identity.email) throw serviceError("The submitted email does not match the verified email; verify this email first", 403);
      if (Number(challenge.proof_expires_at) <= this.clock()) throw serviceError("The email verification expired; verify your email again", 403);
      verifiedAt = new Date(Number(challenge.verified_at)).toISOString();
    }
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (verified) {
        const consumed = this.db.prepare("DELETE FROM questionnaire_email_verifications WHERE response_id = ? AND proof_hash = ? AND proof_expires_at > ?").run(row.id, proofHash, this.clock());
        if (consumed.changes !== 1) throw serviceError("Email verification is required before submitting", 403);
      }
      const updated = this.db.prepare("UPDATE responses SET answers_json = ?, respondent_name = ?, respondent_email = ?, email_verified_at = ?, status = 'submitted', version = version + 1, updated_at = ?, submitted_at = ? WHERE id = ? AND status = 'draft'")
        .run(encoded, identity?.name ?? null, identity?.email ?? null, verifiedAt, now, now, row.id);
      if (updated.changes !== 1) throw serviceError("This response is already submitted", 409);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getResponse(row.questionnaire_id, row.id);
  }

  submitResponse(id, revision, responseId, editToken, answers, respondent, expectedVersion, { verificationProof } = {}) {
    const questionnaire = this.get(id, revision);
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    const row = this.responseRow(id, revision, responseId, editToken);
    return this.finalizeResponse(questionnaire, row, answers, respondent, expectedVersion, verificationProof);
  }

  submitNewResponse(id, revision, respondent, answers) {
    const questionnaire = this.get(id, revision);
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    if (questionnaire.authentication_type === "email_verified") {
      throw serviceError("This questionnaire requires email verification: request a code, verify it, then submit with response_id and verification_proof", 403);
    }
    const validated = validateAnswers(questionnaire.questions, answers, { final: true });
    const identity = this.identityFor(questionnaire, respondent);
    const encoded = JSON.stringify(validated);
    if (Buffer.byteLength(encoded, "utf8") > this.config.maxAnswerBytes) throw serviceError("Answers exceed the storage limit", 413);
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM responses WHERE questionnaire_id = ?").get(questionnaire.questionnaire_id).total;
    if (count >= this.config.maxResponsesPerQuestionnaire) throw serviceError("This questionnaire has reached its response limit", 409);
    const responseId = this.allocateId("responses");
    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO responses (id, questionnaire_id, revision, edit_token_hash, status, answers_json, respondent_name, respondent_email, version, channel, created_at, updated_at, submitted_at) VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, 1, 'mcp', ?, ?, ?)")
      .run(responseId, questionnaire.questionnaire_id, questionnaire.revision, tokenHash, encoded, identity?.name ?? null, identity?.email ?? null, now, now, now);
    return this.getResponse(questionnaire.questionnaire_id, responseId);
  }

  submitMcpVerifiedResponse({ questionnaireId, revision, responseId, respondent, answers, verificationProof }) {
    const row = this.mcpResponseRow(questionnaireId, responseId);
    if (revision !== undefined && this.validateRevision(revision) !== Number(row.revision)) {
      throw serviceError(`response_id belongs to revision ${row.revision}, not revision ${revision}`, 409);
    }
    const questionnaire = this.get(row.questionnaire_id, Number(row.revision));
    return this.finalizeResponse(questionnaire, row, answers, respondent, undefined, verificationProof);
  }

  cleanupVerifications(now) {
    this.db.prepare(`DELETE FROM questionnaire_email_verifications
      WHERE (proof_hash IS NULL OR proof_expires_at <= ?) AND (code_hash IS NULL OR code_expires_at <= ?) AND last_sent_at + ? <= ?`)
      .run(now, now, EMAIL_VERIFICATION_LIMITS.resendCooldownMs, now);
    this.db.prepare("DELETE FROM questionnaire_email_sends WHERE sent_at <= ?").run(now - HOUR_MS);
  }

  // Runs fn under one write lock so checks and the writes that depend on them cannot interleave
  // with another connection or worker using the same database.
  immediate(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    let result;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  assertVerificationOpen(row) {
    const current = this.db.prepare(`SELECT q.status AS questionnaire_status, v.authentication_type, r.status AS response_status
      FROM responses r JOIN questionnaires q ON q.id = r.questionnaire_id
      JOIN questionnaire_revisions v ON v.questionnaire_id = r.questionnaire_id AND v.revision = r.revision
      WHERE r.id = ?`).get(row.id);
    if (!current) throw serviceError("Response not found", 404);
    if (current.questionnaire_status !== "open") throw serviceError("This questionnaire is closed", 409);
    if (current.authentication_type !== "email_verified") throw serviceError("This questionnaire does not use email verification");
    if (current.response_status !== "draft") throw serviceError("This response is already submitted", 409);
  }

  async sendVerificationCode(row, respondent, sourceIp) {
    const questionnaire = this.get(row.questionnaire_id, Number(row.revision));
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    if (questionnaire.authentication_type !== "email_verified") throw serviceError("This questionnaire does not use email verification");
    if (row.status !== "draft") throw serviceError("This response is already submitted", 409);
    const identity = normalizeRespondent(respondent);
    if (!this.mailer?.configured) throw serviceError("Email verification is unavailable right now. No code was sent.", 503);
    const limits = EMAIL_VERIFICATION_LIMITS;
    // Quotas, proofs, and delivery all use the same normalized address.
    const emailHash = sha256(`questionnaire-email:${identity.email.toLowerCase()}`);
    const sourceHash = sha256(`questionnaire-source:${String(sourceIp || "unknown")}`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const salt = randomBytes(16).toString("hex");
    const codeHash = sha256(`${salt}:${code}`);
    const now = this.clock();
    const expiresAt = now + limits.codeTtlMs;
    this.immediate(() => {
      this.cleanupVerifications(now);
      this.assertVerificationOpen(row);
      const existing = this.db.prepare("SELECT last_sent_at FROM questionnaire_email_verifications WHERE response_id = ?").get(row.id);
      if (existing && now - Number(existing.last_sent_at) < limits.resendCooldownMs) {
        const seconds = Math.ceil((limits.resendCooldownMs - (now - Number(existing.last_sent_at))) / 1000);
        throw serviceError(`Please wait ${seconds} seconds before requesting another code`, 429);
      }
      const since = now - HOUR_MS;
      const emailSends = Number(this.db.prepare("SELECT count(*) AS n FROM questionnaire_email_sends WHERE questionnaire_id = ? AND email_hash = ? AND sent_at > ?").get(row.questionnaire_id, emailHash, since).n);
      if (emailSends >= limits.sendsPerEmailPerQuestionnairePerHour) throw serviceError("Too many codes were requested for this email in the last hour. Try again later.", 429);
      const sourceSends = Number(this.db.prepare("SELECT count(*) AS n FROM questionnaire_email_sends WHERE source_hash = ? AND sent_at > ?").get(sourceHash, since).n);
      if (sourceSends >= limits.sendsPerSourcePerHour) throw serviceError("Too many verification emails were requested from this network in the last hour. Try again later.", 429);
      // Delivery attempts count toward the limits whether or not the provider accepts them.
      this.db.prepare("INSERT INTO questionnaire_email_sends (questionnaire_id, email_hash, source_hash, sent_at) VALUES (?, ?, ?, ?)").run(row.questionnaire_id, emailHash, sourceHash, now);
      this.db.prepare(`INSERT OR REPLACE INTO questionnaire_email_verifications
        (response_id, questionnaire_id, revision, email, code_salt, code_hash, code_expires_at, failed_attempts, last_sent_at, proof_hash, proof_expires_at, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL)`)
        .run(row.id, row.questionnaire_id, Number(row.revision), identity.email, salt, codeHash, expiresAt, now);
    });
    try {
      await this.mailer.sendVerificationCode({ to: identity.email, code, questionnaireTitle: questionnaire.title, expiresInMinutes: limits.codeTtlMs / 60_000 });
    } catch (error) {
      this.db?.prepare("UPDATE questionnaire_email_verifications SET code_hash = NULL, code_salt = NULL WHERE response_id = ? AND code_hash = ?").run(row.id, codeHash);
      if (error instanceof ServiceError) throw error;
      throw serviceError("The verification email could not be sent. No code was sent; try again later.", 502);
    }
    return {
      response_id: row.id,
      questionnaire_id: row.questionnaire_id,
      revision: Number(row.revision),
      email: identity.email,
      delivery: "accepted",
      expires_at: new Date(expiresAt).toISOString(),
      resend_available_at: new Date(now + limits.resendCooldownMs).toISOString(),
    };
  }

  confirmVerificationCode(row, email, code) {
    const normalizedEmail = normalizeRespondent({ name: "-", email }).email;
    const candidate = typeof code === "string" ? code.trim() : "";
    const now = this.clock();
    const proof = randomBytes(32).toString("hex");
    const proofExpiresAt = now + EMAIL_VERIFICATION_LIMITS.proofTtlMs;
    // The attempt counter, expiry, and single-use consumption are read and written under one lock.
    // A wrong code commits its counted attempt before the error is raised.
    const outcome = this.immediate(() => {
      this.assertVerificationOpen(row);
      const challenge = this.db.prepare("SELECT * FROM questionnaire_email_verifications WHERE response_id = ?").get(row.id);
      if (!challenge || challenge.email !== normalizedEmail || !challenge.code_hash) {
        throw serviceError("No active verification code for this email; request a new code");
      }
      if (Number(challenge.failed_attempts) >= EMAIL_VERIFICATION_LIMITS.maxFailedAttempts) {
        throw serviceError("Too many incorrect codes; request a new code", 429);
      }
      if (Number(challenge.code_expires_at) <= now) throw serviceError("The verification code expired; request a new code");
      if (!/^\d{6}$/.test(candidate) || !hashesMatch(challenge.code_hash, sha256(`${challenge.code_salt}:${candidate}`))) {
        this.db.prepare("UPDATE questionnaire_email_verifications SET failed_attempts = failed_attempts + 1 WHERE response_id = ?").run(row.id);
        return { remaining: EMAIL_VERIFICATION_LIMITS.maxFailedAttempts - Number(challenge.failed_attempts) - 1 };
      }
      this.db.prepare("UPDATE questionnaire_email_verifications SET code_hash = NULL, code_salt = NULL, proof_hash = ?, proof_expires_at = ?, verified_at = ? WHERE response_id = ?")
        .run(sha256(proof), proofExpiresAt, now, row.id);
      return { verified: true };
    });
    if (!outcome.verified) {
      const { remaining } = outcome;
      throw serviceError(remaining > 0 ? `The verification code is incorrect; ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left` : "The verification code is incorrect; request a new code");
    }
    return {
      response_id: row.id,
      email: normalizedEmail,
      verified_at: new Date(now).toISOString(),
      verification_proof: proof,
      proof_expires_at: new Date(proofExpiresAt).toISOString(),
    };
  }

  requestEmailVerification({ questionnaireId, revision, responseId, editToken, respondent, sourceIp }) {
    return Promise.resolve().then(() => this.sendVerificationCode(this.responseRow(questionnaireId, revision, responseId, editToken), respondent, sourceIp));
  }

  confirmEmailVerification({ questionnaireId, revision, responseId, editToken, email, code }) {
    return this.confirmVerificationCode(this.responseRow(questionnaireId, revision, responseId, editToken), email, code);
  }

  async requestMcpEmailVerification({ questionnaireId, revision, responseId, respondent, sourceIp }) {
    if (responseId !== undefined) {
      const row = this.mcpResponseRow(questionnaireId, responseId);
      if (revision !== undefined && this.validateRevision(revision) !== Number(row.revision)) throw serviceError("Response not found", 404);
      return this.sendVerificationCode(row, respondent, sourceIp);
    }
    const questionnaire = this.get(questionnaireId, revision);
    if (questionnaire.authentication_type !== "email_verified") throw serviceError("This questionnaire does not use email verification");
    normalizeRespondent(respondent);
    const draft = this.createResponse(questionnaire.questionnaire_id, questionnaire.revision, { channel: "mcp" });
    const row = this.mcpResponseRow(questionnaire.questionnaire_id, draft.response_id);
    try {
      return await this.sendVerificationCode(row, respondent, sourceIp);
    } catch (error) {
      this.db?.prepare("DELETE FROM responses WHERE id = ? AND status = 'draft'").run(row.id);
      throw error;
    }
  }

  confirmMcpEmailVerification({ questionnaireId, responseId, email, code }) {
    return this.confirmVerificationCode(this.mcpResponseRow(questionnaireId, responseId), email, code);
  }

  listResponses(id, { revision, status, limit = 50, offset = 0 } = {}) {
    const questionnaireId = this.validateId(id);
    this.get(questionnaireId, revision);
    const conditions = ["r.questionnaire_id = ?"];
    const parameters = [questionnaireId];
    if (revision !== undefined) { conditions.push("r.revision = ?"); parameters.push(this.validateRevision(revision)); }
    if (status !== undefined) {
      if (!["draft", "submitted"].includes(status)) throw serviceError("status must be draft or submitted");
      conditions.push("r.status = ?"); parameters.push(status);
    }
    const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 50, 200));
    const safeOffset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0);
    const where = conditions.join(" AND ");
    const rows = this.db.prepare(`${RESPONSE_SELECT} WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...parameters, safeLimit, safeOffset);
    const total = Number(this.db.prepare(`SELECT count(*) AS count FROM responses r WHERE ${where}`).get(...parameters).count);
    return { responses: rows.map((row) => this.responseSummary(row)), total, limit: safeLimit, offset: safeOffset, has_more: safeOffset + rows.length < total };
  }

  getResponse(id, responseId) {
    const questionnaireId = this.validateId(id);
    const validatedResponseId = this.validateId(responseId, "Response");
    const row = this.db.prepare(`${RESPONSE_SELECT} WHERE r.questionnaire_id = ? AND r.id = ?`).get(questionnaireId, validatedResponseId);
    if (!row) throw serviceError("Response not found", 404);
    return this.publicResponse(row);
  }

  deleteResponse(id, responseId) {
    const response = this.getResponse(id, responseId);
    this.db.prepare("DELETE FROM responses WHERE id = ? AND questionnaire_id = ?").run(response.response_id, response.questionnaire_id);
    return response;
  }
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS,
  MAX_QUESTIONNAIRE_EXPIRY_SECONDS,
  MIN_QUESTIONNAIRE_EXPIRY_SECONDS,
} from "../security.js";
import { RESPONDENT_EMAIL_PATTERN } from "./store.js";

const questionnaireId = z.string().regex(/^[A-Za-z0-9]{24}$/).describe("The 24-character alphanumeric questionnaire ID");
const responseId = z.string().regex(/^[A-Za-z0-9]{24}$/).describe("The 24-character alphanumeric response ID");
const respondentSchema = z.object({
  name: z.string().trim().min(1).max(160).describe("Name of the person submitting the response"),
  email: z.string().trim().max(320).regex(RESPONDENT_EMAIL_PATTERN).describe("Email address of the person submitting the response"),
}).strict();
const answersSchema = z.record(z.string().min(1).max(64), z.json()).describe("Flat question-ID-to-answer object matching the selected questionnaire revision");
const optionSchema = z.object({
  value: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  description: z.string().max(300).optional(),
}).strict();
const conditionValueSchema = z.union([z.string().max(80), z.number().finite(), z.boolean()]);
let questionSchema;
const baseQuestion = {
  id: z.string().min(1).max(64).describe("Stable key used in answer objects"),
  title: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional().default(false),
  show_when: z.array(conditionValueSchema).min(1).max(100).optional().describe("For nested questions only: show when the direct parent's answer equals, or for multiple choice includes, one of these values"),
  children: z.lazy(() => z.array(questionSchema).min(1).max(200)).optional().describe("Questions visually nested beneath this question; child IDs remain flat keys in answer objects. A definition supports at most 200 questions across the entire tree and eight nesting levels."),
};
const textValidation = z.object({
  min_length: z.number().int().min(0).max(100_000).optional(),
  max_length: z.number().int().min(1).max(100_000).optional(),
}).strict();
const numberValidation = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
}).strict();
const selectionValidation = z.object({
  min_selections: z.number().int().min(0).max(100).optional(),
  max_selections: z.number().int().min(1).max(100).optional(),
}).strict();
const textQuestion = (type) => z.object({
  ...baseQuestion,
  type: z.literal(type),
  placeholder: z.string().max(200).optional(),
  validation: textValidation.optional(),
}).strict();
const simpleQuestion = (type) => z.object({ ...baseQuestion, type: z.literal(type) }).strict();
const optionQuestion = (type, maximum = 100) => z.object({
  ...baseQuestion,
  type: z.literal(type),
  options: z.array(optionSchema).min(2).max(maximum),
}).strict();
questionSchema = z.union([
  textQuestion("short_text"), textQuestion("long_text"), textQuestion("email"), textQuestion("url"), textQuestion("phone"),
  z.object({ ...baseQuestion, type: z.literal("number"), validation: numberValidation.optional() }).strict(),
  simpleQuestion("date"), simpleQuestion("time"), simpleQuestion("datetime"),
  optionQuestion("single_choice"),
  z.object({ ...baseQuestion, type: z.literal("multiple_choice"), options: z.array(optionSchema).min(2).max(100), validation: selectionValidation.optional() }).strict(),
  optionQuestion("dropdown"), simpleQuestion("yes_no"), simpleQuestion("consent"),
  z.object({
    ...baseQuestion,
    type: z.literal("rating"),
    settings: z.object({ max: z.number().int().min(3).max(10).optional(), icon: z.enum(["star", "heart", "number"]).optional() }).strict().optional(),
  }).strict(),
  z.object({
    ...baseQuestion,
    type: z.literal("scale"),
    settings: z.object({
      min: z.number().int().min(-10).max(100).optional(),
      max: z.number().int().min(-9).max(100).optional(),
      min_label: z.string().max(100).optional(),
      max_label: z.string().max(100).optional(),
    }).strict().optional(),
  }).strict(),
  optionQuestion("ranking", 30),
  z.object({
    ...baseQuestion,
    type: z.literal("matrix"),
    options: z.array(optionSchema).min(2).max(12),
    rows: z.array(optionSchema).min(1).max(30),
  }).strict(),
]);
const settingsSchema = z.object({
  submit_label: z.string().max(60).optional(),
  completion_message: z.string().max(1000).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  show_progress: z.boolean().optional(),
}).strict();
const definitionSchema = {
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional().default(""),
  questions: z.array(questionSchema).min(1).max(200).describe("At most 200 questions across the entire tree and no more than eight nesting levels."),
  settings: settingsSchema.optional(),
};

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function withShare(store, questionnaire, revision) {
  const share = await store.createSignedUrl(questionnaire.questionnaire_id, undefined, revision);
  const canonicalPath = revision === undefined
    ? `/questionnaire/${questionnaire.questionnaire_id}`
    : `/questionnaire/${questionnaire.questionnaire_id}/r/${revision}`;
  return {
    ...questionnaire,
    canonical_url: `${store.config.publicBaseUrl}${canonicalPath}`,
    url: share.url,
    expires: share.expires,
    expires_at: share.expires_at,
    expires_in_seconds: share.expires_in_seconds,
  };
}

export function createQuestionnaireMcpServer(store) {
  const server = new McpServer({
    name: "personal-questionnaire-collector",
    title: "Personal Questionnaire Collector",
    version: "1.1.0",
    description: "Creates revisioned questionnaires, accepts identified submissions, shares expiring signed answer links, and retrieves responses from SQLite.",
  });

  server.registerTool("create_questionnaire", {
    title: "Create questionnaire",
    description: "Create a questionnaire with one or more typed questions. Returns a signed latest-revision answer URL valid for one week by default.",
    inputSchema: definitionSchema,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async (input) => toolResult(await withShare(store, store.create(input))));

  server.registerTool("update_questionnaire", {
    title: "Update questionnaire",
    description: "Create a new immutable revision. Omitted fields retain their previous values. Existing revision links and responses remain attached to the earlier revision.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      title: z.string().min(1).max(160).optional(),
      description: z.string().max(4000).optional(),
      questions: z.array(questionSchema).min(1).max(200).describe("At most 200 questions across the entire tree and no more than eight nesting levels.").optional(),
      settings: settingsSchema.optional(),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ questionnaire_id, ...changes }) => toolResult(await withShare(store, store.update(questionnaire_id, changes))));

  server.registerTool("get_questionnaire", {
    title: "Get questionnaire",
    description: "Get one questionnaire definition and response counts. Omit revision for the current revision.",
    inputSchema: { questionnaire_id: questionnaireId, revision: z.number().int().min(1).optional() },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ questionnaire_id, revision }) => toolResult(await withShare(store, store.get(questionnaire_id, revision), revision)));

  server.registerTool("list_questionnaires", {
    title: "List questionnaires",
    description: "List questionnaires ordered by most recent update, with current definitions and response counts.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ limit, offset }) => toolResult(store.list({ limit, offset })));

  server.registerTool("get_questionnaire_signed_url", {
    title: "Get signed questionnaire URL",
    description: "Create a fresh expiring latest-revision answer URL by default, or an immutable exact-revision URL when revision is supplied. Duration may be 60 seconds through one year.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      revision: z.number().int().min(1).optional(),
      expires_in_seconds: z.number().int().min(MIN_QUESTIONNAIRE_EXPIRY_SECONDS).max(MAX_QUESTIONNAIRE_EXPIRY_SECONDS).optional().default(DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: true },
  }, async ({ questionnaire_id, revision, expires_in_seconds }) => toolResult(
    await store.createSignedUrl(questionnaire_id, expires_in_seconds, revision),
  ));

  server.registerTool("submit_questionnaire_response", {
    title: "Submit questionnaire response",
    description: "Submit a complete response directly through MCP. Name and email are required for attribution. Omit revision to answer the current revision; this creates one final submission without a browser draft or edit token.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      revision: z.number().int().min(1).optional(),
      respondent: respondentSchema,
      answers: answersSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
  }, async ({ questionnaire_id, revision, respondent, answers }) => toolResult(
    store.submitNewResponse(questionnaire_id, revision, respondent, answers),
  ));

  server.registerTool("set_questionnaire_status", {
    title: "Open or close questionnaire",
    description: "Open a questionnaire for new/autosaved responses or close it. Closing preserves definitions and existing responses.",
    inputSchema: { questionnaire_id: questionnaireId, status: z.enum(["open", "closed"]) },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
  }, async ({ questionnaire_id, status }) => toolResult(await withShare(store, store.setStatus(questionnaire_id, status))));

  server.registerTool("delete_questionnaire", {
    title: "Delete questionnaire",
    description: "Permanently delete a questionnaire, every revision, and all draft and submitted responses.",
    inputSchema: { questionnaire_id: questionnaireId },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ questionnaire_id }) => toolResult({ deleted: true, questionnaire: store.delete(questionnaire_id) }));

  server.registerTool("list_questionnaire_responses", {
    title: "List questionnaire responses",
    description: "List metadata and respondent attribution for draft or submitted responses. Answer bodies and edit tokens are omitted; drafts and legacy submissions may have null respondent identity.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      revision: z.number().int().min(1).optional(),
      status: z.enum(["draft", "submitted"]).optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ questionnaire_id, revision, status, limit, offset }) => toolResult(
    store.listResponses(questionnaire_id, { revision, status, limit, offset }),
  ));

  server.registerTool("get_questionnaire_response", {
    title: "Get questionnaire response",
    description: "Retrieve one response, its respondent attribution, and answers by questionnaire and response ID. Edit tokens are never returned.",
    inputSchema: { questionnaire_id: questionnaireId, response_id: responseId },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ questionnaire_id, response_id }) => toolResult(store.getResponse(questionnaire_id, response_id)));

  server.registerTool("delete_questionnaire_response", {
    title: "Delete questionnaire response",
    description: "Permanently delete one draft or submitted response.",
    inputSchema: { questionnaire_id: questionnaireId, response_id: responseId },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ questionnaire_id, response_id }) => toolResult({
    deleted: true,
    response: store.deleteResponse(questionnaire_id, response_id),
  }));

  return server;
}

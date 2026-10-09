import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  DEFAULT_QUESTIONNAIRE_EXPIRY_SECONDS,
  MAX_QUESTIONNAIRE_EXPIRY_SECONDS,
  MIN_QUESTIONNAIRE_EXPIRY_SECONDS,
} from "../security.js";
import {
  FILE_UPLOAD_DEFAULTS,
  FILE_UPLOAD_HARD_LIMITS,
  REPEATABLE_ROWS_DEFAULTS,
  REPEATABLE_ROWS_HARD_LIMITS,
  RESPONDENT_EMAIL_PATTERN,
  UPLOAD_FORMATS,
} from "./store.js";

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
const uploadSettings = z.object({
  formats: z.array(z.enum(UPLOAD_FORMATS)).min(1).max(UPLOAD_FORMATS.length).optional().describe(`Accepted image formats; defaults to ${UPLOAD_FORMATS.join(", ")}. SVG and other formats are never accepted.`),
  min_files: z.number().int().min(0).max(FILE_UPLOAD_HARD_LIMITS.max_files).optional().describe(`Defaults to ${FILE_UPLOAD_DEFAULTS.min_files}; required questions also need at least one file`),
  max_files: z.number().int().min(1).max(FILE_UPLOAD_HARD_LIMITS.max_files).optional().describe(`Defaults to ${FILE_UPLOAD_DEFAULTS.max_files}`),
  max_bytes: z.number().int().min(1024).max(FILE_UPLOAD_HARD_LIMITS.max_bytes).optional().describe(`Per-file upload limit in bytes; defaults to ${FILE_UPLOAD_DEFAULTS.max_bytes} (5 MiB)`),
}).strict();
// Every answerable type, built on either the top-level question base or the row-field base.
function typedQuestions(base) {
  const textQuestion = (type, extra = {}) => z.object({
    ...base,
    type: z.literal(type),
    placeholder: z.string().max(200).optional(),
    validation: textValidation.optional(),
    ...extra,
  }).strict();
  const simpleQuestion = (type) => z.object({ ...base, type: z.literal(type) }).strict();
  const optionQuestion = (type, maximum = 100) => z.object({
    ...base,
    type: z.literal(type),
    options: z.array(optionSchema).min(2).max(maximum),
  }).strict();
  return [
    textQuestion("short_text"),
    textQuestion("long_text", {
      settings: z.object({
        rich_text: z.boolean().optional().describe("Opt in to a bold/italic/list/link editor. Answers become { format: \"quill_delta_v1\", ops } documents; plain-string answers remain valid. Defaults to false."),
      }).strict().optional(),
    }),
    textQuestion("email"), textQuestion("url"), textQuestion("phone"),
    z.object({ ...base, type: z.literal("number"), validation: numberValidation.optional() }).strict(),
    simpleQuestion("date"), simpleQuestion("time"), simpleQuestion("datetime"),
    optionQuestion("single_choice"),
    z.object({ ...base, type: z.literal("multiple_choice"), options: z.array(optionSchema).min(2).max(100), validation: selectionValidation.optional() }).strict(),
    optionQuestion("dropdown"), simpleQuestion("yes_no"), simpleQuestion("consent"),
    z.object({
      ...base,
      type: z.literal("rating"),
      settings: z.object({ max: z.number().int().min(3).max(10).optional(), icon: z.enum(["star", "heart", "number"]).optional() }).strict().optional(),
    }).strict(),
    z.object({
      ...base,
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
      ...base,
      type: z.literal("matrix"),
      options: z.array(optionSchema).min(2).max(12),
      rows: z.array(optionSchema).min(1).max(30),
    }).strict(),
    z.object({
      ...base,
      type: z.literal("file_upload"),
      settings: uploadSettings.optional(),
    }).strict().describe("Private image upload answered in the browser only. The answer is an array of attachment IDs owned by that response."),
  ];
}
const baseField = {
  id: z.string().min(1).max(64).describe("Stable key inside each row's values object; unique within this group"),
  title: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional().default(false),
};
const rowFieldSchema = z.union(typedQuestions(baseField));
const { children: _children, ...rowsBase } = baseQuestion;
questionSchema = z.union([
  ...typedQuestions(baseQuestion),
  z.object({
    ...rowsBase,
    type: z.literal("repeatable_rows"),
    settings: z.object({
      min_rows: z.number().int().min(0).max(REPEATABLE_ROWS_HARD_LIMITS.max_rows).optional().describe(`Defaults to ${REPEATABLE_ROWS_DEFAULTS.min_rows}; a required group needs at least one row`),
      max_rows: z.number().int().min(1).max(REPEATABLE_ROWS_HARD_LIMITS.max_rows).optional().describe(`Defaults to ${REPEATABLE_ROWS_DEFAULTS.max_rows}`),
      add_label: z.string().max(60).optional(),
    }).strict().optional(),
    fields: z.array(rowFieldSchema).min(1).max(REPEATABLE_ROWS_HARD_LIMITS.max_fields).describe("Typed fields repeated in every row. Row fields cannot be repeatable groups, conditional, or nested."),
  }).strict().describe("Respondent-managed list of rows. The answer is an ordered array of { row_id, values } objects; row_id is a stable caller-chosen ID (letters, digits, dash, underscore; at most 40) unique within the answer."),
]);
const settingsSchema = z.object({
  submit_label: z.string().max(60).optional(),
  completion_message: z.string().max(1000).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  show_progress: z.boolean().optional(),
}).strict();
const authenticationTypeSchema = z.enum(["anonymous", "self_report", "email_verified"])
  .describe("How respondents identify themselves. anonymous: no name or email is collected. self_report: name and email are required but not checked. email_verified: name is self-reported and the email must be confirmed with a one-time code sent to it. Fixed for each revision.");
const definitionSchema = {
  title: z.string().min(1).max(160),
  authentication_type: authenticationTypeSchema.optional().describe("Defaults to anonymous for new questionnaires."),
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

// sourceIp is the caller's address for per-IP verification limits; the default exists only for direct factory use in tests.
export function createQuestionnaireMcpServer(store, { sourceIp = "mcp-direct" } = {}) {
  const server = new McpServer({
    name: "personal-questionnaire-collector",
    title: "Personal Questionnaire Collector",
    version: "1.2.0",
    description: "Creates revisioned questionnaires with anonymous, self-reported, or email-verified respondents, shares expiring signed answer links, and retrieves responses from SQLite.",
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
      authentication_type: authenticationTypeSchema.optional().describe("Mode for the new revision. Omit to keep the previous revision's mode."),
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

  server.registerTool("request_questionnaire_email_verification", {
    title: "Request questionnaire email verification",
    description: "For email_verified questionnaires only. Sends a six-digit code to the respondent's email and returns a response_id for the pending submission. The code expires in 10 minutes. Resending needs the same response_id, waits 60 seconds, and replaces the earlier code. The code is never returned here; the respondent must read it from their inbox (it may land in spam or junk).",
    inputSchema: {
      questionnaire_id: questionnaireId,
      revision: z.number().int().min(1).optional().describe("Omit to answer the current revision"),
      response_id: responseId.optional().describe("Pending response from an earlier request, to resend or change the email"),
      respondent: respondentSchema,
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  }, async ({ questionnaire_id, revision, response_id, respondent }) => toolResult(
    await store.requestMcpEmailVerification({ questionnaireId: questionnaire_id, revision, responseId: response_id, respondent, sourceIp }),
  ));

  server.registerTool("verify_questionnaire_email", {
    title: "Verify questionnaire email",
    description: "Check the code the respondent received. Returns a single-use verification_proof bound to this response and email, valid for 30 minutes. Five wrong codes lock the code until a new one is requested.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      response_id: responseId,
      email: z.string().trim().max(320).regex(RESPONDENT_EMAIL_PATTERN),
      code: z.string().trim().regex(/^\d{6}$/).describe("Six-digit code from the verification email"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
  }, async ({ questionnaire_id, response_id, email, code }) => toolResult(
    store.confirmMcpEmailVerification({ questionnaireId: questionnaire_id, responseId: response_id, email, code }),
  ));

  server.registerTool("submit_questionnaire_response", {
    title: "Submit questionnaire response",
    description: "Submit a complete response directly through MCP. anonymous: omit respondent. self_report: respondent name and email are required. email_verified: first call request_questionnaire_email_verification and verify_questionnaire_email, then pass response_id, verification_proof, and the same respondent email. Omit revision to answer the current revision.",
    inputSchema: {
      questionnaire_id: questionnaireId,
      revision: z.number().int().min(1).optional(),
      respondent: respondentSchema.optional(),
      answers: answersSchema,
      response_id: responseId.optional().describe("email_verified only: response_id from request_questionnaire_email_verification"),
      verification_proof: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("email_verified only: proof from verify_questionnaire_email"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
  }, async ({ questionnaire_id, revision, respondent, answers, response_id, verification_proof }) => {
    if (response_id !== undefined || verification_proof !== undefined) {
      return toolResult(store.submitMcpVerifiedResponse({ questionnaireId: questionnaire_id, revision, responseId: response_id, respondent, answers, verificationProof: verification_proof }));
    }
    return toolResult(store.submitNewResponse(questionnaire_id, revision, respondent, answers));
  });

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
    description: "List metadata and respondent attribution for draft or submitted responses. identity_status is anonymous, self_reported, email_verified, legacy_missing (submitted before identity was collected), or pending (draft). Answer bodies and edit tokens are omitted.",
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
    description: "Retrieve one response, its respondent attribution, and answers by questionnaire and response ID. Uploaded images referenced by the answers are listed under attachments with private download URLs that expire after one hour; call again for fresh URLs. Edit tokens are never returned.",
    inputSchema: { questionnaire_id: questionnaireId, response_id: responseId },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
  }, async ({ questionnaire_id, response_id }) => {
    const response = store.getResponse(questionnaire_id, response_id);
    return toolResult({ ...response, attachments: await store.attachments.withDownloadUrls(response.questionnaire_id, response.attachments) });
  });

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

import { randomBytes } from "node:crypto";
import contentDisposition from "content-disposition";
import express from "express";
import { readFile } from "node:fs/promises";
import { ServiceError } from "../errors.js";
import {
  createQuestionnaireResponseScope,
  questionnaireResponseScopeIsValid,
  questionnaireSignedUrlIsValid,
} from "../security.js";
import { QUILL_ASSET_PATH, QUILL_VERSION, renderQuestionnaire } from "./ui.js";
import { QUESTIONNAIRE_LANDING_HTML } from "../module-landings.js";

const INSTALL_README = await readFile(new URL("../../public/questionnaire-README.md", import.meta.url), "utf8");
const COMPANION_SKILL = await readFile(new URL("../../public/questionnaire-SKILL.md", import.meta.url), "utf8");
// The one editor bundle answer pages may load. The installed package must match the pinned version.
const QUILL_PACKAGE = JSON.parse(await readFile(new URL("../../node_modules/quill/package.json", import.meta.url), "utf8"));
if (QUILL_PACKAGE.version !== QUILL_VERSION) throw new Error(`Expected quill ${QUILL_VERSION}, found ${QUILL_PACKAGE.version}`);
const QUILL_BUNDLE = (await readFile(new URL("../../node_modules/quill/dist/quill.js", import.meta.url), "utf8"))
  .replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, "\n");


function baseHeaders(response) {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Referrer-Policy", "no-referrer");
  response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  response.set("Cache-Control", "private, no-store");
}

function requireSameOrigin(request, config) {
  if (request.get("sec-fetch-site") === "cross-site") throw new ServiceError(403, "Cross-site request rejected");
  const origin = request.get("origin");
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new ServiceError(403, "Invalid request origin"); }
  const allowed = new Set([
    new URL(config.publicBaseUrl).origin,
    `${request.protocol}://${request.get("host")}`,
  ]);
  if (!allowed.has(parsed.origin)) throw new ServiceError(403, "Cross-site request rejected");
}

function requireJson(request) {
  if (!request.is("application/json")) throw new ServiceError(415, "Content-Type must be application/json");
}

async function authorizedQuestionnaire(request, store, config, { responseRequest = false } = {}) {
  const questionnaireId = store.validateId(request.params.questionnaireId);
  const revision = request.params.revision === undefined
    ? undefined
    : store.validateRevision(request.params.revision);
  const valid = await questionnaireSignedUrlIsValid({
    questionnaireId,
    revision,
    expires: request.query.expires,
    signature: request.query.signature,
    secretFile: config.secretFile,
  });
  if (!valid) throw new ServiceError(404, "Questionnaire not found");
  let definitionRevision = revision;
  if (responseRequest && revision === undefined) {
    definitionRevision = store.validateRevision(request.query.response_revision);
    const validResponseScope = await questionnaireResponseScopeIsValid({
      questionnaireId,
      revision: definitionRevision,
      expires: request.query.expires,
      shareSignature: request.query.signature,
      responseSignature: request.query.response_signature,
      secretFile: config.secretFile,
    });
    if (!validResponseScope) throw new ServiceError(404, "Questionnaire not found");
  }
  return store.get(questionnaireId, definitionRevision);
}

function publicQuestionnaire(questionnaire) {
  return {
    questionnaire_id: questionnaire.questionnaire_id,
    revision: questionnaire.revision,
    status: questionnaire.status,
    title: questionnaire.title,
    description: questionnaire.description,
    questions: questionnaire.questions,
    settings: questionnaire.settings,
    authentication_type: questionnaire.authentication_type,
  };
}

export function sendAttachment(response, attachments, attachment, next) {
  baseHeaders(response);
  response.set("Content-Type", attachment.content_type);
  response.set("Content-Disposition", contentDisposition(attachment.filename, { type: "inline" }));
  response.set("Content-Security-Policy", "sandbox; default-src 'none'");
  // The path is built from validated IDs; "allow" only stops a dot-directory in the data path from hiding it.
  response.sendFile(attachments.filePath(attachment.questionnaire_id, attachment.id), { cacheControl: false, lastModified: false, etag: false, dotfiles: "allow" }, (error) => {
    if (!error) return;
    for (const header of ["Content-Type", "Content-Disposition"]) response.removeHeader(header);
    if (error.status === 404) return next(new ServiceError(404, "Attachment not found"));
    next(error);
  });
}

export function mountQuestionnaireRoutes(app, store, config) {
  const answerJson = express.json({ limit: config.maxAnswerBytes + 16 * 1024, strict: true });
  const pages = ["/questionnaire/:questionnaireId", "/questionnaire/:questionnaireId/r/:revision"];
  const responses = ["/questionnaire/:questionnaireId/responses", "/questionnaire/:questionnaireId/r/:revision/responses"];
  const responseItems = ["/questionnaire/:questionnaireId/responses/:responseId", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId"];
  const verifications = ["/questionnaire/:questionnaireId/responses/:responseId/verification", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/verification"];
  const confirmations = ["/questionnaire/:questionnaireId/responses/:responseId/verification/confirm", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/verification/confirm"];
  const submissions = ["/questionnaire/:questionnaireId/responses/:responseId/submit", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/submit"];
  const uploadGrants = ["/questionnaire/:questionnaireId/responses/:responseId/attachments/capability", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/attachments/capability"];
  const uploads = ["/questionnaire/:questionnaireId/responses/:responseId/attachments", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/attachments"];
  const previews = ["/questionnaire/:questionnaireId/responses/:responseId/attachments/:attachmentId", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/attachments/:attachmentId"];
  const attachments = store.attachments;

  app.get(QUILL_ASSET_PATH, (request, response) => {
    baseHeaders(response);
    response.set("Cache-Control", "public, max-age=31536000, immutable");
    response.set("Cross-Origin-Resource-Policy", "same-origin");
    response.type("text/javascript").send(QUILL_BUNDLE);
  });
  app.get(["/questionnaire", "/questionnaire/"], (request, response) => {
    baseHeaders(response);
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.type("html").send(QUESTIONNAIRE_LANDING_HTML);
  });

  app.get(["/questionnaire/README.md", "/questionnaire/install.md"], (request, response) => {
    baseHeaders(response);
    response.type("text/markdown; charset=utf-8").send(INSTALL_README);
  });

  app.get("/questionnaire/SKILL.md", (request, response) => {
    baseHeaders(response);
    response.type("text/markdown; charset=utf-8").send(COMPANION_SKILL);
  });

  app.get(pages, async (request, response, next) => {
    if (request.params.questionnaireId === "mcp") return next("route");
    try {
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: false });
      const definition = publicQuestionnaire(questionnaire);
      if (request.params.revision === undefined) {
        definition.response_scope = {
          revision: questionnaire.revision,
          signature: await createQuestionnaireResponseScope({
            questionnaireId: questionnaire.questionnaire_id,
            revision: questionnaire.revision,
            expires: request.query.expires,
            shareSignature: request.query.signature,
            secretFile: config.secretFile,
          }),
        };
      }
      const nonce = randomBytes(18).toString("base64");
      baseHeaders(response);
      response.set("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
      response.type("html").send(renderQuestionnaire(definition, nonce));
    } catch (error) { next(error); }
  });

  app.post(responses, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const draft = store.createResponse(questionnaire.questionnaire_id, questionnaire.revision);
      baseHeaders(response);
      response.status(201).json(draft);
    } catch (error) { next(error); }
  });

  app.get(responseItems, async (request, response, next) => {
    try {
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const result = store.getResponseForEdit(
        questionnaire.questionnaire_id,
        questionnaire.revision,
        request.params.responseId,
        request.get("x-questionnaire-edit-token"),
      );
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });

  app.patch(responseItems, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const result = store.saveResponse(
        questionnaire.questionnaire_id,
        questionnaire.revision,
        request.params.responseId,
        request.get("x-questionnaire-edit-token"),
        request.body?.answers,
        request.body?.version,
      );
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });

  app.post(submissions, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const result = store.submitResponse(
        questionnaire.questionnaire_id,
        questionnaire.revision,
        request.params.responseId,
        request.get("x-questionnaire-edit-token"),
        request.body?.answers,
        request.body?.respondent,
        request.body?.version,
        { verificationProof: request.body?.verification_proof },
      );
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });

  // Upload capabilities are short lived and bound to the response, revision, question, row, and field.
  app.post(uploadGrants, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const row = store.responseRow(questionnaire.questionnaire_id, questionnaire.revision, request.params.responseId, request.get("x-questionnaire-edit-token"));
      const result = await attachments.grantCapability(questionnaire, row, request.body || {});
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });

  app.post(uploads, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const row = store.responseRow(questionnaire.questionnaire_id, questionnaire.revision, request.params.responseId, request.get("x-questionnaire-edit-token"));
      const result = await attachments.receive({ questionnaire, row, query: request.query, request, sourceIp: request.ip });
      baseHeaders(response);
      response.status(201).json(result);
    } catch (error) {
      // An unread body must not be drained into a kept-alive connection.
      if (!request.complete) response.set("Connection", "close");
      next(error);
    }
  });

  app.get(previews, async (request, response, next) => {
    try {
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const row = store.responseRow(questionnaire.questionnaire_id, questionnaire.revision, request.params.responseId, request.get("x-questionnaire-edit-token"));
      const attachment = attachments.stored(questionnaire.questionnaire_id, request.params.attachmentId);
      if (!attachment || attachment.response_id !== row.id) throw new ServiceError(404, "Attachment not found");
      sendAttachment(response, attachments, attachment, next);
    } catch (error) { next(error); }
  });

  app.get("/questionnaire/:questionnaireId/attachments/:attachmentId", async (request, response, next) => {
    try {
      const questionnaireId = store.validateId(request.params.questionnaireId);
      const attachment = await attachments.authorizedDownload(questionnaireId, request.params.attachmentId, request.query);
      if (!attachment) throw new ServiceError(404, "Attachment not found");
      sendAttachment(response, attachments, attachment, next);
    } catch (error) { next(error); }
  });

  app.post(verifications, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const result = await store.requestEmailVerification({
        questionnaireId: questionnaire.questionnaire_id,
        revision: questionnaire.revision,
        responseId: request.params.responseId,
        editToken: request.get("x-questionnaire-edit-token"),
        respondent: request.body?.respondent,
        sourceIp: request.ip,
      });
      baseHeaders(response);
      response.status(202).json(result);
    } catch (error) { next(error); }
  });

  app.post(confirmations, answerJson, async (request, response, next) => {
    try {
      requireSameOrigin(request, config);
      requireJson(request);
      const questionnaire = await authorizedQuestionnaire(request, store, config, { responseRequest: true });
      const result = store.confirmEmailVerification({
        questionnaireId: questionnaire.questionnaire_id,
        revision: questionnaire.revision,
        responseId: request.params.responseId,
        editToken: request.get("x-questionnaire-edit-token"),
        email: request.body?.email,
        code: request.body?.code,
      });
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });
}

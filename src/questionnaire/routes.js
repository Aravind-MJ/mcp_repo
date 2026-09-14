import { randomBytes } from "node:crypto";
import express from "express";
import { readFile } from "node:fs/promises";
import { ServiceError } from "../errors.js";
import {
  createQuestionnaireResponseScope,
  questionnaireResponseScopeIsValid,
  questionnaireSignedUrlIsValid,
} from "../security.js";
import { renderQuestionnaire } from "./ui.js";
import { QUESTIONNAIRE_LANDING_HTML } from "../module-landings.js";

const INSTALL_README = await readFile(new URL("../../public/questionnaire-README.md", import.meta.url), "utf8");
const COMPANION_SKILL = await readFile(new URL("../../public/questionnaire-SKILL.md", import.meta.url), "utf8");


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
  };
}

export function mountQuestionnaireRoutes(app, store, config) {
  const answerJson = express.json({ limit: config.maxAnswerBytes + 16 * 1024, strict: true });
  const pages = ["/questionnaire/:questionnaireId", "/questionnaire/:questionnaireId/r/:revision"];
  const responses = ["/questionnaire/:questionnaireId/responses", "/questionnaire/:questionnaireId/r/:revision/responses"];
  const responseItems = ["/questionnaire/:questionnaireId/responses/:responseId", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId"];
  const submissions = ["/questionnaire/:questionnaireId/responses/:responseId/submit", "/questionnaire/:questionnaireId/r/:revision/responses/:responseId/submit"];

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
      response.set("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
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
      );
      baseHeaders(response);
      response.json(result);
    } catch (error) { next(error); }
  });
}

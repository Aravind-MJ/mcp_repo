import { randomBytes } from "node:crypto";
import express from "express";
import { ServiceError } from "../errors.js";
import { questionnaireAdminCsrfIsValid, questionnaireAdminCsrfToken } from "../security.js";

const PAGE_SIZE = 60;
const RESPONSE_PAGE_SIZE = 100;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function parseOffset(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function adminHeaders(response, nonce = "") {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Referrer-Policy", "no-referrer");
  response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  response.set("Cache-Control", "private, no-store");
  response.set("X-Frame-Options", "DENY");
  if (nonce) {
    response.set("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  }
}

function requireTrustedBasicAuth(request, response, next) {
  if (request.get("x-questionnaire-basic-auth") === "1") return next();
  adminHeaders(response);
  return response.status(404).type("text").send("Not found");
}

function shell({ title, eyebrow, count = "", content, nonce, script = "" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${escapeHtml(title)}</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#090b10;--panel:#11141b;--raised:#181c25;--line:#292e3a;--text:#f5f6f8;--muted:#9aa2b1;--accent:#a8b4ff;--accent2:#d7ddff;--success:#7ee2ae;--warning:#ffd083;--danger:#ff858d}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:radial-gradient(circle at 12% -10%,#212849 0,transparent 35rem),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}button,input,select{font:inherit}header,main,.toolbar{width:min(1200px,calc(100% - 32px));margin-inline:auto}header{display:flex;justify-content:space-between;align-items:end;gap:24px;padding:58px 0 28px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:17px}.brand img{width:60px;height:60px;border-radius:16px;box-shadow:0 14px 44px #0008}.eyebrow{margin:0 0 7px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}h1{margin:0;font-size:clamp(36px,6vw,68px);line-height:.95;letter-spacing:-.055em}h2,h3,p{margin-top:0}.count{color:var(--muted);white-space:nowrap}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 0 0}.toolbar a,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:11px;background:var(--raised);color:var(--text);font-weight:700;text-decoration:none;cursor:pointer}.toolbar a:hover,.button:hover{border-color:#596176}.button.primary{background:var(--accent);border-color:var(--accent);color:#111526}.button.danger{background:#2b171b;border-color:#683039;color:#ffbdc2}.button:disabled{opacity:.55;cursor:wait}main.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,350px),1fr));gap:18px;padding:24px 0 64px}.card{position:relative;display:flex;flex-direction:column;min-height:280px;padding:22px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#151923,var(--panel));box-shadow:0 18px 55px #0003}.card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:999px;background:#12261e;color:var(--success);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.pill.closed{background:#292219;color:var(--warning)}.dot{width:7px;height:7px;border-radius:50%;background:currentColor}.card h2{margin:20px 0 9px;font-size:23px;line-height:1.15;letter-spacing:-.025em}.card h2 a{text-decoration:none}.card h2 a:hover{text-decoration:underline}.description{color:var(--muted);display:-webkit-box;overflow:hidden;-webkit-line-clamp:3;-webkit-box-orient:vertical}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:auto 0 17px;padding-top:18px}.stat{padding:10px;border:1px solid var(--line);border-radius:11px;background:#0c0f15}.stat strong{display:block;font-size:20px}.stat span{color:var(--muted);font-size:12px}.meta{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:12px}.meta code{overflow:hidden;text-overflow:ellipsis}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.actions form{display:inline}.icon-button{display:grid;place-items:center;width:40px;height:40px;margin-left:auto;padding:0;border:1px solid #71353f;border-radius:11px;background:#28151a;color:var(--danger);cursor:pointer}.empty{grid-column:1/-1;padding:70px 24px;border:1px dashed #3a4050;border-radius:18px;text-align:center;color:var(--muted)}.empty h2{color:var(--text)}.pagination{display:flex;justify-content:center;gap:10px;padding:0 0 60px}.copy-status{position:fixed;z-index:30;left:50%;bottom:22px;max-width:min(560px,calc(100% - 32px));padding:12px 16px;border:1px solid #35624c;border-radius:11px;background:#13271df2;color:#bcf5d3;box-shadow:0 14px 42px #000a;opacity:0;pointer-events:none;transform:translate(-50%,8px);transition:opacity .18s ease,transform .18s ease}.copy-status.visible{opacity:1;transform:translate(-50%,0)}.copy-status.error{border-color:#783a44;background:#2b171bf2;color:#ffc2c7}.list{display:grid;gap:12px;padding:24px 0 64px}.response{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:var(--panel);text-decoration:none}.response:hover{border-color:#596176}.response .number{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--raised);color:var(--accent2);font-weight:850}.response strong{display:block}.response small{color:var(--muted)}.response .arrow{color:var(--muted);font-size:22px}.filters{display:flex;flex-wrap:wrap;gap:10px}.filters select{min-height:40px;padding:7px 34px 7px 11px;border:1px solid var(--line);border-radius:10px;background:var(--raised);color:var(--text)}.detail{padding:26px 0 64px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:24px}.summary>div{padding:14px;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.summary dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.summary dd{margin:4px 0 0;font-weight:750}.answers{display:grid;gap:12px}.answer{padding:19px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.answer-children{display:grid;gap:12px;margin:16px 0 0 18px;padding-left:14px;border-left:2px solid var(--line)}.answer h2,.answer h3,.answer h4,.answer h5,.answer h6{margin-bottom:6px;font-size:16px}.condition{margin:0 0 9px;color:var(--accent);font-size:12px;font-weight:700}.answer-value{color:#e4e6eb;overflow-wrap:anywhere}.answer-value ol,.answer-value dl{margin:8px 0 0;padding-left:22px}.answer-value dd{margin:0 0 7px}.muted{color:var(--muted)}dialog{width:min(500px,calc(100% - 32px));padding:0;border:1px solid #4b3138;border-radius:18px;background:#151217;color:var(--text);box-shadow:0 30px 90px #000c}dialog::backdrop{background:#040507c7}.dialog-shell{padding:23px}.dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}:focus-visible{outline:3px solid #d5dcff;outline-offset:3px}@media(max-width:640px){header{align-items:start;flex-direction:column;padding-top:34px}.count{white-space:normal}.toolbar{align-items:stretch;flex-direction:column}.toolbar .filters{width:100%}.response{grid-template-columns:auto 1fr}.response .arrow{display:none}.stats{grid-template-columns:1fr}.meta{flex-direction:column}.actions .button{flex:1}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head><body>
<header><div class="brand"><img src="/logo.svg" alt="" width="60" height="60"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1></div></div><div class="count">${escapeHtml(count)}</div></header>
${content}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

function responseStatusLabel(status) {
  return status === "submitted" ? "Submitted" : "Draft";
}

function optionLabel(question, value) {
  return question.options?.find((option) => option.value === value)?.label ?? value;
}

function questionCount(questions) {
  return questions.reduce((total, question) => total + 1 + questionCount(question.children || []), 0);
}

function conditionMatches(expected, value) {
  if (Array.isArray(value)) return value.some((item) => expected.some((candidate) => Object.is(candidate, item)));
  return expected.some((candidate) => Object.is(candidate, value));
}

function conditionValueLabel(parent, value) {
  if (["single_choice", "multiple_choice", "dropdown", "ranking", "matrix"].includes(parent.type)) return optionLabel(parent, value);
  if (parent.type === "yes_no") return value === "yes" ? "Yes" : "No";
  if (parent.type === "consent") return value === true ? "Agreed" : "Not agreed";
  return String(value);
}

function renderAnswerValue(question, value) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return `<span class="muted">No answer</span>`;
  if (["single_choice", "dropdown"].includes(question.type)) return escapeHtml(optionLabel(question, value));
  if (question.type === "multiple_choice") return `<ol>${value.map((item) => `<li>${escapeHtml(optionLabel(question, item))}</li>`).join("")}</ol>`;
  if (question.type === "ranking") return `<ol>${value.map((item) => `<li>${escapeHtml(optionLabel(question, item))}</li>`).join("")}</ol>`;
  if (question.type === "matrix") {
    return `<dl>${question.rows.map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${value[row.value] === undefined ? '<span class="muted">No answer</span>' : escapeHtml(optionLabel(question, value[row.value]))}</dd>`).join("")}</dl>`;
  }
  if (question.type === "yes_no") return value === "yes" || value === true ? "Yes" : "No";
  if (question.type === "consent") return value === true ? "Agreed" : "Not agreed";
  if (Array.isArray(value)) return `<ol>${value.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  if (typeof value === "object") return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return escapeHtml(value);
}

function renderAnswerQuestions(questions, answers, depth = 1, parent = null) {
  return questions.map((question) => {
    if (question.show_when && (!parent || !conditionMatches(question.show_when, answers[parent.id]))) return "";
    const condition = question.show_when && parent
      ? `<p class="condition">Follow-up when parent answer is: ${question.show_when.map((value) => escapeHtml(conditionValueLabel(parent, value))).join(" or ")}</p>`
      : "";
    const headingLevel = Math.min(depth + 1, 6);
    const children = renderAnswerQuestions(question.children || [], answers, depth + 1, question);
    return `<section class="answer depth-${depth}"><h${headingLevel}>${escapeHtml(question.title)}</h${headingLevel}>${condition}<div class="answer-value">${renderAnswerValue(question, answers[question.id])}</div>${children ? `<div class="answer-children" role="group" aria-label="Follow-up answers">${children}</div>` : ""}</section>`;
  }).join("");
}

function indexScript() {
  return `const statusBox=document.getElementById("copy-status");for(const button of document.querySelectorAll("[data-sign-questionnaire]")){button.addEventListener("click",async()=>{button.disabled=true;try{const response=await fetch("/questionnaires/"+button.dataset.signQuestionnaire+"/sign",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf_token:button.dataset.csrfToken})});if(!response.ok)throw new Error("Could not create a signed URL");const payload=await response.json();await navigator.clipboard.writeText(payload.url);statusBox.textContent="Copied a one-week answer link, valid until "+new Date(payload.expires_at).toLocaleString()+".";statusBox.className="copy-status visible"}catch(error){statusBox.textContent=error.message;statusBox.className="copy-status visible error"}finally{button.disabled=false;setTimeout(()=>statusBox.className="copy-status",5000)}})}for(const trigger of document.querySelectorAll("[data-delete-dialog]")){trigger.addEventListener("click",()=>document.getElementById(trigger.dataset.deleteDialog)?.showModal())}for(const button of document.querySelectorAll(".cancel-delete")){button.addEventListener("click",()=>button.closest("dialog")?.close())}for(const dialog of document.querySelectorAll("dialog")){dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()})}`;
}

async function renderIndex(store, config, offset, nonce) {
  const result = store.list({ limit: PAGE_SIZE, offset });
  const items = await Promise.all(result.questionnaires.map(async (questionnaire) => ({
    questionnaire,
    share: await store.createSignedUrl(questionnaire.questionnaire_id),
    signToken: await questionnaireAdminCsrfToken(questionnaire.questionnaire_id, "sign", config.secretFile),
    statusToken: await questionnaireAdminCsrfToken(questionnaire.questionnaire_id, "status", config.secretFile),
    deleteToken: await questionnaireAdminCsrfToken(questionnaire.questionnaire_id, "delete", config.secretFile),
  })));
  const cards = items.map(({ questionnaire, share, signToken, statusToken, deleteToken }) => {
    const id = escapeHtml(questionnaire.questionnaire_id);
    const title = escapeHtml(questionnaire.title);
    const nextStatus = questionnaire.status === "open" ? "closed" : "open";
    const nextStatusLabel = questionnaire.status === "open" ? "Close" : "Reopen";
    return `<article class="card"><div class="card-top"><span class="pill ${questionnaire.status === "closed" ? "closed" : ""}"><span class="dot"></span>${escapeHtml(questionnaire.status)}</span><span class="muted">Revision ${questionnaire.revision}</span></div><h2><a href="${escapeHtml(share.url)}" target="_blank" rel="noopener noreferrer">${title}</a></h2><p class="description">${escapeHtml(questionnaire.description || "No description")}</p><div class="stats"><div class="stat"><strong>${questionCount(questionnaire.questions)}</strong><span>questions</span></div><div class="stat"><strong>${questionnaire.response_counts.drafts}</strong><span>${questionnaire.response_counts.drafts === 1 ? "draft" : "drafts"}</span></div><div class="stat"><strong>${questionnaire.response_counts.submitted}</strong><span>submitted</span></div></div><div class="meta"><code>${id}</code><span>${escapeHtml(formatDate(questionnaire.updated_at))}</span></div><div class="actions"><a class="button" href="/questionnaires/${id}/responses">Responses</a><button type="button" class="button" data-sign-questionnaire="${id}" data-csrf-token="${escapeHtml(signToken)}">Copy link</button><form method="post" action="/questionnaires/${id}/status"><input type="hidden" name="csrf_token" value="${escapeHtml(statusToken)}"><input type="hidden" name="status" value="${nextStatus}"><button class="button" type="submit">${nextStatusLabel}</button></form><button type="button" class="icon-button" data-delete-dialog="delete-${id}" aria-label="Delete ${title}" title="Delete questionnaire">×</button></div><dialog id="delete-${id}" aria-labelledby="delete-title-${id}"><div class="dialog-shell"><p class="eyebrow">Permanent action</p><h3 id="delete-title-${id}">Delete this questionnaire?</h3><p><strong>${title}</strong>, every revision, and every response will be permanently deleted. Existing share links will stop working.</p><div class="dialog-actions"><button type="button" class="button cancel-delete">Cancel</button><form method="post" action="/questionnaires/${id}/delete"><input type="hidden" name="csrf_token" value="${escapeHtml(deleteToken)}"><button type="submit" class="button danger">Delete permanently</button></form></div></div></dialog></article>`;
  }).join("");
  const content = cards || `<section class="empty"><h2>No questionnaires yet</h2><p>Create one through the Questionnaire MCP and it will appear here.</p></section>`;
  const previous = offset > 0 ? `<a class="button" href="/questionnaires?offset=${Math.max(0, offset - PAGE_SIZE)}">Previous</a>` : "";
  const next = result.has_more ? `<a class="button" href="/questionnaires?offset=${offset + PAGE_SIZE}">Next</a>` : "";
  return shell({ title: "Questionnaires", eyebrow: "Private index", count: `${result.total} ${result.total === 1 ? "questionnaire" : "questionnaires"}`, nonce, content: `<div class="toolbar"><span class="muted">Manage forms, links, status, and collected responses.</span><a href="/questionnaire/README.md">MCP guide</a></div><div id="copy-status" class="copy-status" role="status" aria-live="polite"></div><main class="grid">${content}</main>${previous || next ? `<nav class="pagination" aria-label="Questionnaire pages">${previous}${next}</nav>` : ""}`, script: indexScript() });
}

function renderResponseList(questionnaire, result, status, nonce) {
  const id = escapeHtml(questionnaire.questionnaire_id);
  const responses = result.responses.map((item, index) => {
    const label = item.respondent?.name || `${responseStatusLabel(item.status)} · Revision ${item.revision}`;
    const details = item.respondent
      ? `${responseStatusLabel(item.status)} · Revision ${item.revision} · ${item.respondent.email}`
      : `${responseStatusLabel(item.status)} · Revision ${item.revision}`;
    return `<a class="response" href="/questionnaires/${id}/responses/${escapeHtml(item.response_id)}"><span class="number">${result.offset + index + 1}</span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(details)}<br>${escapeHtml(formatDate(item.submitted_at || item.updated_at))} · ${escapeHtml(item.response_id)}</small></span><span class="arrow" aria-hidden="true">→</span></a>`;
  }).join("") || `<section class="empty"><h2>No ${escapeHtml(status || "")} responses</h2><p>Responses will appear here as people save or submit the form.</p></section>`;
  const query = (newOffset) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("offset", String(newOffset));
    return `/questionnaires/${id}/responses?${params}`;
  };
  const previous = result.offset > 0 ? `<a class="button" href="${query(Math.max(0, result.offset - RESPONSE_PAGE_SIZE))}">Previous</a>` : "";
  const next = result.has_more ? `<a class="button" href="${query(result.offset + RESPONSE_PAGE_SIZE)}">Next</a>` : "";
  const filter = `<form class="filters" method="get"><label class="sr-only" for="status-filter">Response status</label><select id="status-filter" name="status"><option value=""${!status ? " selected" : ""}>All responses</option><option value="submitted"${status === "submitted" ? " selected" : ""}>Submitted</option><option value="draft"${status === "draft" ? " selected" : ""}>Drafts</option></select><button class="button" type="submit">Filter</button></form>`;
  return shell({ title: questionnaire.title, eyebrow: "Collected responses", count: `${result.total} ${result.total === 1 ? "response" : "responses"}`, nonce, content: `<div class="toolbar"><a href="/questionnaires">← All questionnaires</a>${filter}</div><main class="list">${responses}</main>${previous || next ? `<nav class="pagination" aria-label="Response pages">${previous}${next}</nav>` : ""}` });
}

async function renderResponseDetail(store, questionnaire, item, config, nonce) {
  const id = escapeHtml(questionnaire.questionnaire_id);
  const responseId = escapeHtml(item.response_id);
  const deleteToken = await questionnaireAdminCsrfToken(questionnaire.questionnaire_id, "delete-response", config.secretFile, item.response_id);
  const answers = renderAnswerQuestions(questionnaire.questions, item.answers);
  const respondent = item.respondent
    ? `<div><dt>Respondent</dt><dd>${escapeHtml(item.respondent.name)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(item.respondent.email)}</dd></div>`
    : `<div><dt>Respondent</dt><dd class="muted">Not recorded</dd></div>`;
  return shell({ title: responseStatusLabel(item.status), eyebrow: questionnaire.title, count: `Revision ${item.revision}`, nonce, content: `<div class="toolbar"><a href="/questionnaires/${id}/responses">← All responses</a><button class="button danger" type="button" data-delete-dialog="delete-response">Delete response</button></div><main class="detail"><dl class="summary"><div><dt>Status</dt><dd>${responseStatusLabel(item.status)}</dd></div>${respondent}<div><dt>Created</dt><dd>${escapeHtml(formatDate(item.created_at))}</dd></div><div><dt>Updated</dt><dd>${escapeHtml(formatDate(item.updated_at))}</dd></div><div><dt>Response ID</dt><dd><code>${responseId}</code></dd></div></dl><div class="answers">${answers}</div></main><dialog id="delete-response" aria-labelledby="delete-response-title"><div class="dialog-shell"><p class="eyebrow">Permanent action</p><h3 id="delete-response-title">Delete this response?</h3><p>The saved answers will be permanently removed. This cannot be undone.</p><div class="dialog-actions"><button type="button" class="button cancel-delete">Cancel</button><form method="post" action="/questionnaires/${id}/responses/${responseId}/delete"><input type="hidden" name="csrf_token" value="${escapeHtml(deleteToken)}"><button type="submit" class="button danger">Delete response</button></form></div></div></dialog>`, script: `const dialog=document.getElementById("delete-response");document.querySelector("[data-delete-dialog]").addEventListener("click",()=>dialog.showModal());document.querySelector(".cancel-delete").addEventListener("click",()=>dialog.close());dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()})` });
}

export function mountQuestionnaireAdminRoutes(app, store, config) {
  const formParser = express.urlencoded({ extended: false, limit: "4kb", parameterLimit: 8 });
  app.use("/questionnaires", requireTrustedBasicAuth);

  app.get(["/questionnaires", "/questionnaires/"], async (request, response, next) => {
    try {
      const nonce = randomBytes(18).toString("base64");
      adminHeaders(response, nonce);
      response.type("html").send(await renderIndex(store, config, parseOffset(request.query.offset), nonce));
    } catch (error) { next(error); }
  });

  app.post("/questionnaires/:questionnaireId/sign", formParser, async (request, response, next) => {
    try {
      const id = store.validateId(request.params.questionnaireId);
      if (!(await questionnaireAdminCsrfIsValid(id, "sign", request.body?.csrf_token, config.secretFile))) throw new ServiceError(403, "Invalid questionnaire confirmation token");
      const signed = await store.createSignedUrl(id);
      adminHeaders(response);
      response.json(signed);
    } catch (error) { next(error); }
  });

  app.post("/questionnaires/:questionnaireId/status", formParser, async (request, response, next) => {
    try {
      const id = store.validateId(request.params.questionnaireId);
      if (!(await questionnaireAdminCsrfIsValid(id, "status", request.body?.csrf_token, config.secretFile))) throw new ServiceError(403, "Invalid questionnaire confirmation token");
      store.setStatus(id, request.body?.status);
      adminHeaders(response);
      response.redirect(303, "/questionnaires");
    } catch (error) { next(error); }
  });

  app.post("/questionnaires/:questionnaireId/delete", formParser, async (request, response, next) => {
    try {
      const id = store.validateId(request.params.questionnaireId);
      if (!(await questionnaireAdminCsrfIsValid(id, "delete", request.body?.csrf_token, config.secretFile))) throw new ServiceError(403, "Invalid questionnaire confirmation token");
      store.delete(id);
      adminHeaders(response);
      response.redirect(303, "/questionnaires");
    } catch (error) { next(error); }
  });

  app.get("/questionnaires/:questionnaireId/responses", (request, response, next) => {
    try {
      const questionnaire = store.get(request.params.questionnaireId);
      const status = typeof request.query.status === "string" && ["draft", "submitted"].includes(request.query.status) ? request.query.status : undefined;
      const result = store.listResponses(questionnaire.questionnaire_id, { status, limit: RESPONSE_PAGE_SIZE, offset: parseOffset(request.query.offset) });
      const nonce = randomBytes(18).toString("base64");
      adminHeaders(response, nonce);
      response.type("html").send(renderResponseList(questionnaire, result, status, nonce));
    } catch (error) { next(error); }
  });

  app.get("/questionnaires/:questionnaireId/responses/:responseId", async (request, response, next) => {
    try {
      const item = store.getResponse(request.params.questionnaireId, request.params.responseId);
      const questionnaire = store.get(request.params.questionnaireId, item.revision);
      const nonce = randomBytes(18).toString("base64");
      adminHeaders(response, nonce);
      response.type("html").send(await renderResponseDetail(store, questionnaire, item, config, nonce));
    } catch (error) { next(error); }
  });

  app.post("/questionnaires/:questionnaireId/responses/:responseId/delete", formParser, async (request, response, next) => {
    try {
      const id = store.validateId(request.params.questionnaireId);
      const responseId = store.validateId(request.params.responseId, "Response");
      if (!(await questionnaireAdminCsrfIsValid(id, "delete-response", request.body?.csrf_token, config.secretFile, responseId))) throw new ServiceError(403, "Invalid questionnaire confirmation token");
      store.deleteResponse(id, responseId);
      adminHeaders(response);
      response.redirect(303, `/questionnaires/${id}/responses`);
    } catch (error) { next(error); }
  });
}

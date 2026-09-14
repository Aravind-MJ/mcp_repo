import { QUESTIONNAIRE_CSS } from "./theme.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029",
  })[character]);
}

const PROGRESS_WIDTH_CSS = Array.from({ length: 101 }, (_, percent) => `.progress-track>span[data-percent="${percent}"]{width:${percent}%}`).join("");

function attrs(question) {
  const validation = question.validation || {};
  return [
    question.required ? " required" : "",
    validation.min_length !== undefined ? ` minlength="${validation.min_length}"` : "",
    validation.max_length !== undefined ? ` maxlength="${validation.max_length}"` : "",
    validation.min !== undefined ? ` min="${validation.min}"` : "",
    validation.max !== undefined ? ` max="${validation.max}"` : "",
    validation.step !== undefined ? ` step="${validation.step}"` : "",
  ].join("");
}

function renderOptions(question, inputType) {
  return question.options.map((option) => `<label class="option-card">
    <input type="${inputType}" name="${escapeHtml(question.id)}" value="${escapeHtml(option.value)}"${question.required && inputType === "radio" ? " required" : ""}>
    <span class="option-indicator" aria-hidden="true"></span>
    <span class="option-copy"><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span>
  </label>`).join("");
}

function renderControl(question) {
  const id = escapeHtml(question.id);
  const titleId = `question-title-${id}`;
  const errorId = `question-error-${id}`;
  const descriptionId = question.description ? `question-description-${id}` : "";
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");
  const placeholderValue = question.placeholder || (question.type === "url" ? "https://" : "");
  const placeholder = placeholderValue ? ` placeholder="${escapeHtml(placeholderValue)}"` : "";
  const common = ` id="q-${id}"${placeholder}${attrs(question)} aria-labelledby="${titleId}" aria-describedby="${describedBy}"`;
  const group = ` role="group" aria-labelledby="${titleId}" aria-describedby="${describedBy}"`;
  switch (question.type) {
    case "short_text": return `<input class="text-control" type="text" name="${id}"${common}>`;
    case "long_text": return `<textarea class="text-control" name="${id}"${common} rows="5"></textarea><div class="character-count" id="question-count-${id}" data-count-for="${id}"></div>`;
    case "email": return `<input class="text-control" type="email" name="${id}"${common} inputmode="email" autocomplete="email">`;
    case "url": return `<input class="text-control" type="url" name="${id}"${common} inputmode="url">`;
    case "phone": return `<input class="text-control" type="tel" name="${id}"${common} inputmode="tel" autocomplete="tel">`;
    case "number": return `<input class="text-control compact" type="number" name="${id}"${common} inputmode="decimal">`;
    case "date": return `<input class="text-control compact" type="date" name="${id}"${common}>`;
    case "time": return `<input class="text-control compact" type="time" name="${id}"${common}>`;
    case "datetime": return `<input class="text-control compact" type="datetime-local" name="${id}"${common}>`;
    case "single_choice": return `<div class="option-list"${group}>${renderOptions(question, "radio")}</div>`;
    case "multiple_choice": return `<div class="option-list" data-multiple-choice="${id}" data-min="${Math.max(question.required ? 1 : 0, question.validation?.min_selections ?? 0)}" data-max="${question.validation?.max_selections ?? ""}"${group}>${renderOptions(question, "checkbox")}</div><p class="field-hint selection-hint" aria-live="polite"></p>`;
    case "dropdown": return `<div class="select-wrap"><select class="text-control" name="${id}" id="q-${id}"${question.required ? " required" : ""} aria-labelledby="${titleId}" aria-describedby="${describedBy}"><option value="">Choose an option</option>${question.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select><span aria-hidden="true">⌄</span></div>`;
    case "yes_no": return `<div class="segmented"${group}><label><input type="radio" name="${id}" value="yes"${question.required ? " required" : ""}><span>Yes</span></label><label><input type="radio" name="${id}" value="no"><span>No</span></label></div>`;
    case "consent": return `<div${group}><label class="consent-card"><input type="checkbox" name="${id}" id="q-${id}"${question.required ? " required" : ""}><span class="checkmark" aria-hidden="true">✓</span><span>I understand and agree</span></label></div>`;
    case "rating": {
      const icon = question.settings.icon === "heart" ? "♥" : question.settings.icon === "number" ? null : "★";
      return `<fieldset class="rating" data-rating aria-describedby="${describedBy}"><legend class="sr-only">${escapeHtml(question.title)}: choose a rating from 1 to ${question.settings.max}</legend>${Array.from({ length: question.settings.max }, (_, index) => { const value = index + 1; return `<label><input type="radio" name="${id}" value="${value}"${question.required && value === 1 ? " required" : ""}><span aria-hidden="true">${icon || value}</span><span class="sr-only">${value} out of ${question.settings.max}</span></label>`; }).join("")}</fieldset>`;
    }
    case "scale": {
      const values = Array.from({ length: question.settings.max - question.settings.min + 1 }, (_, index) => question.settings.min + index);
      return `<div class="scale-wrap" data-scale${group}><div class="scale-options">${values.map((value, index) => `<label><input type="radio" name="${id}" value="${value}"${question.required && index === 0 ? " required" : ""}><span>${value}</span></label>`).join("")}</div><div class="scale-labels"><span>${escapeHtml(question.settings.min_label)}</span><span>${escapeHtml(question.settings.max_label)}</span></div></div>`;
    }
    case "ranking": return `<div class="ranking" data-ranking="${id}" data-ranking-answered="false"${question.required ? ' data-ranking-required="true"' : ""}${group}><p class="field-hint">Use the arrow buttons to arrange from highest to lowest priority.</p><p class="sr-only" aria-live="polite" data-ranking-status></p><ol>${question.options.map((option, index) => `<li data-value="${escapeHtml(option.value)}"><span class="rank-number">${index + 1}</span><span class="rank-label">${escapeHtml(option.label)}</span><span class="rank-actions"><button type="button" data-rank-up aria-label="Move ${escapeHtml(option.label)} up"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-rank-down aria-label="Move ${escapeHtml(option.label)} down"${index === question.options.length - 1 ? " disabled" : ""}>↓</button></span></li>`).join("")}</ol></div>`;
    case "matrix": return `<div class="matrix-scroll"${group}><table class="matrix"><caption class="sr-only">${escapeHtml(question.title)}</caption><thead><tr><th scope="col">Item</th>${question.options.map((option) => `<th scope="col">${escapeHtml(option.label)}</th>`).join("")}</tr></thead><tbody>${question.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th>${question.options.map((option, optionIndex) => `<td><label><input type="radio" name="${id}__${escapeHtml(row.value)}" value="${escapeHtml(option.value)}"${question.required && optionIndex === 0 ? " required" : ""}><span class="sr-only">${escapeHtml(row.label)}: ${escapeHtml(option.label)}</span></label></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    default: return "";
  }
}

function initialVisibleQuestionCount(questions) {
  return questions.reduce((count, question) => {
    if (question.show_when) return count;
    return count + 1 + initialVisibleQuestionCount(question.children || []);
  }, 0);
}

const QUESTION_HINTS = {
  short_text: "Short answer", long_text: "Long answer", email: "Email address",
  url: "Website link", phone: "Phone number", number: "Number", date: "Date",
  time: "Time", datetime: "Date & time", single_choice: "Choose one",
  multiple_choice: "Choose multiple", dropdown: "Choose one", yes_no: "Choose one",
  consent: "Confirmation", rating: "Choose a rating", scale: "Choose a value",
  ranking: "Order by priority", matrix: "Choose one per row",
};

function renderQuestion(question, index, depth = 1, parentId = "", parentNumber = "") {
  const escapedId = escapeHtml(question.id);
  const titleId = `question-title-${escapedId}`;
  const descriptionId = `question-description-${escapedId}`;
  const errorId = `question-error-${escapedId}`;
  const number = depth === 1 ? String(index + 1).padStart(2, "0") : `${parentNumber}.${index + 1}`;
  const parentAttributes = parentId ? ` data-parent-question="${escapeHtml(parentId)}"` : "";
  const conditionAttribute = question.show_when ? ` data-show-when="${escapeHtml(JSON.stringify(question.show_when))}" hidden` : "";
  const children = question.children?.length
    ? `<div class="nested-questions">${question.children.map((child, childIndex) => renderQuestion(child, childIndex, depth + 1, question.id, number)).join("")}</div>`
    : "";
  return `<section class="question-card${depth > 1 ? " nested-question" : ""}" id="question-${escapedId}" data-question data-question-id="${escapedId}" data-question-type="${escapeHtml(question.type)}" data-question-depth="${depth}"${parentAttributes}${conditionAttribute} aria-labelledby="${titleId}">
    <div class="question-number" aria-hidden="true">${number}</div>
    <div class="question-body">
      <div class="question-metadata">
        ${depth > 1 ? `<span class="follow-up-label">Follow-up ${number}</span>` : ""}
        <span>${QUESTION_HINTS[question.type] || escapeHtml(question.type)}</span>
        <span class="${question.required ? "requirement" : "optional"}">${question.required ? "Required" : "Optional"}</span>
      </div>
      <div class="question-heading">
        <h2 id="${titleId}" tabindex="-1">${escapeHtml(question.title)}${question.required ? `<span class="required" aria-hidden="true">*</span><span class="sr-only"> (Required)</span>` : ""}</h2>
        ${question.description ? `<p id="${descriptionId}">${escapeHtml(question.description)}</p>` : ""}
      </div>
      ${renderControl(question)}
      <p class="field-error" id="${errorId}" data-error-for="${escapedId}" aria-live="polite"></p>
    </div>
    ${children}
  </section>`;
}

const CLIENT_SCRIPT = String.raw`
(async function () {
  "use strict";
  const definition = JSON.parse(document.getElementById("questionnaire-data").textContent);
  const form = document.getElementById("questionnaire-form");
  const outline = document.getElementById("question-outline");
  const narrowViewport = window.matchMedia("(max-width: 800px)");
  function adaptOutline() { if (outline) outline.open = !narrowViewport.matches; }
  adaptOutline();
  narrowViewport.addEventListener("change", adaptOutline);
  const introduction = document.querySelector(".introduction");
  function measureIntroduction() {
    if (!introduction || introduction.open) return;
    const description = introduction.querySelector(".hero-description");
    const clamped = description.scrollHeight > description.clientHeight + 1;
    introduction.dataset.clamped = String(clamped);
    introduction.querySelector("summary").tabIndex = clamped ? 0 : -1;
  }
  if (introduction) {
    introduction.querySelector("summary").addEventListener("click", function (event) {
      if (introduction.dataset.clamped === "false") event.preventDefault();
    });
    introduction.addEventListener("toggle", measureIntroduction);
    window.addEventListener("resize", measureIntroduction);
    measureIntroduction();
  }
  if (!form || definition.status !== "open") return;
  const questionnaireFields = document.getElementById("questionnaire-fields");
  const cards = Array.from(document.querySelectorAll("[data-question]"));
  const statuses = Array.from(document.querySelectorAll("[data-autosave-state]"));
  const progressBars = Array.from(document.querySelectorAll("[data-progress-bar]"));
  const progressTexts = Array.from(document.querySelectorAll("[data-progress-text]"));
  const submitButton = document.getElementById("submit-response");
  const alertBox = document.getElementById("form-alert");
  const storageKey = "questionnaire-draft:" + definition.questionnaire_id + ":" + definition.revision;
  const basePath = window.location.pathname;
  const capabilityParams = new URLSearchParams(window.location.search);
  if (definition.response_scope) {
    capabilityParams.set("response_revision", String(definition.response_scope.revision));
    capabilityParams.set("response_signature", definition.response_scope.signature);
  }
  const capability = "?" + capabilityParams.toString();
  let draft = null;
  let draftPromise = null;
  let saveTimer = null;
  let saving = null;
  let dirty = false;
  let changeVersion = 0;
  let savedVersion = 0;

  function api(suffix) { return basePath + suffix + capability; }
  function sessionGet(key) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
  function sessionSet(key, value) { try { window.sessionStorage.setItem(key, value); } catch { return false; } return true; }
  function sessionRemove(key) { try { window.sessionStorage.removeItem(key); } catch { return false; } return true; }
  function setStatus(message, state) {
    for (const status of statuses) {
      status.textContent = message;
      status.dataset.state = state || "idle";
    }
  }
  function requestHeaders() {
    return { "Content-Type": "application/json", "X-Questionnaire-Edit-Token": draft ? draft.edit_token : "" };
  }
  function selected(name) { return form.querySelector('input[name="' + CSS.escape(name) + '"]:checked'); }
  function flattenQuestions(items, parentId) {
    const flattened = [];
    for (const question of items) {
      flattened.push(question);
      if (parentId) parentById.set(question.id, parentId);
      if (question.children) flattened.push(...flattenQuestions(question.children, question.id));
    }
    return flattened;
  }
  const parentById = new Map();
  const flatQuestions = flattenQuestions(definition.questions, "");
  const questionById = new Map(flatQuestions.map(function (question) { return [question.id, question]; }));
  function conditionMatches(expected, value) {
    if (Array.isArray(value)) return value.some(function (item) { return expected.some(function (candidate) { return Object.is(candidate, item); }); });
    return expected.some(function (candidate) { return Object.is(candidate, value); });
  }
  function rawAnswers() {
    const answers = {};
    for (const question of flatQuestions) {
      const name = question.id;
      if (question.type === "multiple_choice") {
        answers[name] = Array.from(form.querySelectorAll('input[name="' + CSS.escape(name) + '"]:checked')).map(function (input) { return input.value; });
      } else if (question.type === "consent") {
        const control = form.elements.namedItem(name);
        if (control) answers[name] = control.checked;
      } else if (["single_choice", "yes_no", "rating", "scale"].includes(question.type)) {
        const input = selected(name);
        if (input) answers[name] = ["rating", "scale"].includes(question.type) ? Number(input.value) : input.value;
      } else if (question.type === "ranking") {
        const ranking = document.querySelector('[data-ranking="' + CSS.escape(name) + '"]');
        if (ranking && ranking.dataset.rankingAnswered === "true") answers[name] = Array.from(ranking.querySelectorAll("li")).map(function (item) { return item.dataset.value; });
      } else if (question.type === "matrix") {
        const value = {};
        for (const row of question.rows) {
          const input = selected(name + "__" + row.value);
          if (input) value[row.value] = input.value;
        }
        answers[name] = value;
      } else {
        const control = form.elements.namedItem(name);
        if (control && control.value !== "") answers[name] = question.type === "number" ? Number(control.value) : control.value;
      }
    }
    return answers;
  }
  function activeQuestions(answers) {
    const active = [];
    function visit(items, parentVisible, parentValue) {
      for (const question of items) {
        const visible = parentVisible && (!question.show_when || conditionMatches(question.show_when, parentValue));
        if (!visible) continue;
        active.push(question);
        if (question.children) visit(question.children, visible, answers[question.id]);
      }
    }
    visit(definition.questions, true, undefined);
    return active;
  }
  function currentAnswers() {
    const raw = rawAnswers();
    const answers = {};
    for (const question of activeQuestions(raw)) {
      if (raw[question.id] !== undefined) answers[question.id] = raw[question.id];
    }
    return answers;
  }
  function currentRespondent() {
    return {
      name: String(form.elements.namedItem("respondent_name")?.value || "").trim(),
      email: String(form.elements.namedItem("respondent_email")?.value || "").trim(),
    };
  }
  function updateVisibility() {
    const answers = rawAnswers();
    const activeIds = new Set(activeQuestions(answers).map(function (question) { return question.id; }));
    for (const card of cards) {
      const visible = activeIds.has(card.dataset.questionId);
      if (visible && card.hidden) card.dataset.revealed = "true";
      if (!visible) delete card.dataset.revealed;
      card.hidden = !visible;
      card.setAttribute("aria-hidden", visible ? "false" : "true");
      for (const control of card.querySelectorAll("input, textarea, select, button")) {
        if (control.closest("[data-question]") === card) control.disabled = !visible;
      }
      if (!visible) {
        card.removeAttribute("aria-invalid");
        for (const control of card.querySelectorAll("input, textarea, select")) control.setCustomValidity("");
        const error = card.querySelector("[data-error-for]");
        if (error) error.textContent = "";
      }
    }
  }
  function isComplete(question, answers) {
    const value = answers[question.id];
    if (question.type === "consent") return value === true;
    if (question.type === "multiple_choice") {
      const minimum = Math.max(question.required ? 1 : 0, question.validation?.min_selections || 0);
      const maximum = question.validation?.max_selections ?? Infinity;
      return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.length > 0;
    }
    if (question.type === "ranking") return Array.isArray(value) && value.length === question.options.length;
    if (question.type === "matrix") return value && typeof value === "object" && Object.keys(value).length === question.rows.length;
    if (typeof value === "string") {
      const cleaned = value.trim();
      if (!cleaned) return false;
      const validation = question.validation || {};
      if (validation.min_length !== undefined && cleaned.length < validation.min_length) return false;
      if (validation.max_length !== undefined && cleaned.length > validation.max_length) return false;
      if (question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return false;
      if (question.type === "url") {
        try { if (!/^https?:$/.test(new URL(cleaned).protocol)) return false; } catch { return false; }
      }
      if (question.type === "phone" && (!/^[+()\d\s.-]{5,40}$/.test(cleaned) || !/\d/.test(cleaned))) return false;
      return true;
    }
    if (question.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      const validation = question.validation || {};
      if (validation.min !== undefined && value < validation.min) return false;
      if (validation.max !== undefined && value > validation.max) return false;
      if (validation.step !== undefined) {
        const ratio = (value - (validation.min || 0)) / validation.step;
        if (Math.abs(ratio - Math.round(ratio)) > Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8) return false;
      }
    }
    return value !== undefined && value !== null && value !== "";
  }
  function updateProgress() {
    const answers = currentAnswers();
    const visibleQuestions = activeQuestions(answers);
    const completed = visibleQuestions.filter(function (question) { return isComplete(question, answers); }).length;
    const percent = visibleQuestions.length ? Math.round((completed / visibleQuestions.length) * 100) : 0;
    for (const progressBar of progressBars) {
      progressBar.dataset.percent = String(percent);
      progressBar.parentElement.setAttribute("aria-valuenow", String(percent));
    }
    for (const progressText of progressTexts) progressText.textContent = completed + " of " + visibleQuestions.length + " shown answered";
    const activeIds = new Set(visibleQuestions.map(function (question) { return question.id; }));
    function sectionComplete(question) {
      if (!activeIds.has(question.id)) return true;
      return isComplete(question, answers) && (question.children || []).every(sectionComplete);
    }
    for (const link of document.querySelectorAll("[data-question-link]")) {
      const question = questionById.get(link.dataset.questionLink);
      const complete = Boolean(question && sectionComplete(question));
      link.classList.toggle("complete", complete);
      const state = link.querySelector("[data-section-state]");
      if (state) state.textContent = complete ? " — section complete" : "";
    }
    const nextButton = document.getElementById("next-unanswered");
    if (nextButton) {
      const allAnswered = visibleQuestions.every(function (question) { return isComplete(question, answers); });
      nextButton.disabled = allAnswered || questionnaireFields.disabled;
      nextButton.querySelector("[data-next-label]").textContent = allAnswered ? "All shown answered" : "Next unanswered";
    }
    for (const textarea of form.querySelectorAll("textarea[maxlength]")) {
      const counter = document.querySelector('[data-count-for="' + CSS.escape(textarea.name) + '"]');
      if (counter) counter.textContent = textarea.value.length + " / " + textarea.maxLength;
    }
  }
  function clearErrors() {
    alertBox.hidden = true;
    for (const element of document.querySelectorAll("[data-error-for]")) element.textContent = "";
    for (const element of form.querySelectorAll('[aria-invalid="true"]')) element.removeAttribute("aria-invalid");
  }
  function showError(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
    const id = String(message).split(":", 1)[0];
    const fieldError = document.querySelector('[data-error-for="' + CSS.escape(id) + '"]');
    const card = document.getElementById("question-" + id);
    if (fieldError) fieldError.textContent = String(message).slice(id.length + 1).trim();
    if (card) {
      card.setAttribute("aria-invalid", "true");
      const firstInvalid = card.querySelector("input, textarea, select, button");
      if (firstInvalid) firstInvalid.focus();
      card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } else {
      alertBox.focus();
    }
  }
  async function decode(response) {
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "The request could not be completed.");
    return body;
  }
  async function ensureDraft() {
    if (draft) return draft;
    if (!draftPromise) {
      draftPromise = (async function () {
        const created = await decode(await fetch(api("/responses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
        draft = { response_id: created.response_id, edit_token: created.edit_token, version: created.version };
        sessionSet(storageKey, JSON.stringify(draft));
        return draft;
      })().finally(function () { draftPromise = null; });
    }
    return draftPromise;
  }
  async function save(options) {
    const settings = options || {};
    if (saving) await saving;
    if (!dirty && !settings.force) return;
    const savingVersion = changeVersion;
    const answers = currentAnswers();
    saving = (async function () {
      setStatus("Saving…", "saving");
      await ensureDraft();
      const response = await fetch(api("/responses/" + draft.response_id), {
        method: "PATCH", headers: requestHeaders(), body: JSON.stringify({ answers: answers, version: draft.version }), keepalive: Boolean(settings.keepalive),
      });
      const saved = await decode(response);
      draft.version = saved.version;
      sessionSet(storageKey, JSON.stringify(draft));
      savedVersion = Math.max(savedVersion, savingVersion);
      dirty = savedVersion !== changeVersion;
      setStatus(dirty ? "Unsaved changes" : "All changes saved", dirty ? "dirty" : "saved");
    })().catch(function (error) {
      setStatus(navigator.onLine ? "Save failed" : "Offline — changes pending", "error");
      throw error;
    }).finally(function () { saving = null; });
    return saving;
  }
  function scheduleSave() {
    changeVersion += 1;
    dirty = true;
    setStatus("Unsaved changes", "dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save().catch(function (error) { showError(error.message); }); }, 700);
  }
  function hydrate(answers) {
    for (const question of flatQuestions) {
      const value = answers[question.id];
      if (value === undefined) continue;
      const name = question.id;
      if (question.type === "multiple_choice") {
        for (const input of form.querySelectorAll('input[name="' + CSS.escape(name) + '"]')) input.checked = value.includes(input.value);
      } else if (question.type === "consent") {
        form.elements.namedItem(name).checked = value === true;
      } else if (["single_choice", "yes_no", "rating", "scale"].includes(question.type)) {
        const input = form.querySelector('input[name="' + CSS.escape(name) + '"][value="' + CSS.escape(String(value)) + '"]');
        if (input) input.checked = true;
      } else if (question.type === "ranking" && Array.isArray(value)) {
        const ranking = document.querySelector('[data-ranking="' + CSS.escape(name) + '"]');
        const list = ranking.querySelector("ol");
        for (const itemValue of value) {
          const item = list.querySelector('li[data-value="' + CSS.escape(itemValue) + '"]');
          if (item) list.appendChild(item);
        }
        ranking.dataset.rankingAnswered = "true";
        renumberRanking(list);
      } else if (question.type === "matrix") {
        for (const row of Object.keys(value)) {
          const input = form.querySelector('input[name="' + CSS.escape(name + "__" + row) + '"][value="' + CSS.escape(String(value[row])) + '"]');
          if (input) input.checked = true;
        }
      } else {
        const control = form.elements.namedItem(name);
        if (control) control.value = value;
      }
    }
    updateVisibility();
    updateProgress();
  }
  async function restoreDraft() {
    let stored;
    try { stored = JSON.parse(sessionGet(storageKey)); } catch { sessionRemove(storageKey); }
    if (!stored || !stored.response_id || !stored.edit_token) return;
    draft = stored;
    const restoreVersion = changeVersion;
    try {
      const response = await fetch(api("/responses/" + draft.response_id), { headers: requestHeaders() });
      if ([404, 410].includes(response.status)) {
        sessionRemove(storageKey);
        draft = null;
        return;
      }
      const restored = await decode(response);
      if (restored.status === "submitted") {
        sessionRemove(storageKey);
        draft = null;
        return;
      }
      draft.version = restored.version;
      sessionSet(storageKey, JSON.stringify(draft));
      if (changeVersion === restoreVersion) hydrate(restored.answers || {});
      setStatus(changeVersion === restoreVersion ? "Draft restored" : "Unsaved changes", changeVersion === restoreVersion ? "saved" : "dirty");
    } catch {
      setStatus("Draft restore temporarily unavailable — your recovery key is retained", "error");
    }
  }
  function validateScalarPatterns() {
    let valid = true;
    for (const question of flatQuestions) {
      if (!["short_text", "long_text", "email", "url", "phone"].includes(question.type)) continue;
      const control = form.elements.namedItem(question.id);
      if (!control || control.disabled || typeof control.value !== "string") continue;
      const value = control.value.trim();
      let message = "";
      if (question.required && !value) message = "This answer is required.";
      else if (value && question.type === "url") {
        try { if (!/^https?:$/.test(new URL(value).protocol)) message = "Enter an HTTP or HTTPS URL."; } catch { message = "Enter an HTTP or HTTPS URL."; }
      } else if (value && question.type === "phone" && (!/^[+()\d\s.-]{5,40}$/.test(value) || !/\d/.test(value))) {
        message = "Enter a valid phone number.";
      }
      control.setCustomValidity(message);
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(question.id) + '"]');
      if (fieldError && message) fieldError.textContent = message;
      if (message) valid = false;
    }
    return valid;
  }
  function validateSelections() {
    let valid = validateScalarPatterns();
    for (const group of document.querySelectorAll("[data-multiple-choice]")) {
      if (group.closest("[data-question]")?.hidden) continue;
      const count = group.querySelectorAll("input:checked").length;
      const min = Number(group.dataset.min || 0);
      const max = group.dataset.max ? Number(group.dataset.max) : Infinity;
      const first = group.querySelector("input");
      const message = count < min ? "Select at least " + min + "." : count > max ? "Select no more than " + max + "." : "";
      first.setCustomValidity(message);
      group.nextElementSibling.textContent = message;
      if (message) group.setAttribute("aria-invalid", "true"); else group.removeAttribute("aria-invalid");
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(group.dataset.multipleChoice) + '"]');
      if (fieldError) fieldError.textContent = message;
      if (message) valid = false;
    }
    for (const ranking of document.querySelectorAll('[data-ranking-required="true"]')) {
      if (ranking.closest("[data-question]")?.hidden) continue;
      const message = ranking.dataset.rankingAnswered === "true" ? "" : "Arrange this ranking before submitting.";
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(ranking.dataset.ranking) + '"]');
      if (fieldError) fieldError.textContent = message;
      if (message) ranking.setAttribute("aria-invalid", "true"); else ranking.removeAttribute("aria-invalid");
      if (message) valid = false;
    }
    return valid;
  }
  function renumberRanking(list, movedItem) {
    const items = Array.from(list.children);
    items.forEach(function (item, index) {
      item.querySelector(".rank-number").textContent = String(index + 1);
      const up = item.querySelector("[data-rank-up]");
      const down = item.querySelector("[data-rank-down]");
      up.disabled = index === 0;
      down.disabled = index === items.length - 1;
    });
    if (movedItem) {
      const status = list.parentElement.querySelector("[data-ranking-status]");
      const position = items.indexOf(movedItem) + 1;
      if (status) status.textContent = movedItem.querySelector(".rank-label").textContent + " moved to position " + position + " of " + items.length + ".";
    }
  }
  for (const ranking of document.querySelectorAll("[data-ranking]")) {
    ranking.addEventListener("click", function (event) {
      const button = event.target.closest("button");
      if (!button) return;
      const item = button.closest("li");
      if (button.hasAttribute("data-rank-up") && item.previousElementSibling) item.parentElement.insertBefore(item, item.previousElementSibling);
      if (button.hasAttribute("data-rank-down") && item.nextElementSibling) item.parentElement.insertBefore(item.nextElementSibling, item);
      ranking.dataset.rankingAnswered = "true";
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(ranking.dataset.ranking) + '"]');
      if (fieldError) fieldError.textContent = "";
      renumberRanking(item.parentElement, item);
      updateProgress(); scheduleSave();
    });
  }
  form.addEventListener("input", function () { updateVisibility(); clearErrors(); validateSelections(); updateProgress(); scheduleSave(); });
  form.addEventListener("change", function () { updateVisibility(); clearErrors(); validateSelections(); updateProgress(); scheduleSave(); });
  form.addEventListener("submit", async function (event) {
    event.preventDefault(); clearErrors();
    const selectionsValid = validateSelections();
    const nativeValid = form.reportValidity();
    if (!selectionsValid || !nativeValid) {
      const firstInvalid = form.querySelector(":invalid") || document.querySelector('[data-ranking-required="true"][data-ranking-answered="false"] button:not(:disabled)');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    submitButton.disabled = true; submitButton.textContent = "Submitting…";
    try {
      clearTimeout(saveTimer);
      if (saving) await saving;
      await ensureDraft();
      const result = await decode(await fetch(api("/responses/" + draft.response_id + "/submit"), {
        method: "POST", headers: requestHeaders(), body: JSON.stringify({ answers: currentAnswers(), respondent: currentRespondent(), version: draft.version }),
      }));
      sessionRemove(storageKey); dirty = false;
      document.getElementById("questionnaire-shell").hidden = true;
      const completion = document.getElementById("completion-screen");
      completion.hidden = false; completion.focus();
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setStatus("Response submitted", "saved");
      return result;
    } catch (error) {
      showError(error.message); submitButton.disabled = false; submitButton.textContent = definition.settings.submit_label;
    }
  });
  window.addEventListener("online", function () { if (dirty) save().catch(function () {}); });
  window.addEventListener("offline", function () { setStatus("Offline — changes pending", "error"); });
  window.addEventListener("pagehide", function () {
    if (dirty && draft) fetch(api("/responses/" + draft.response_id), { method: "PATCH", headers: requestHeaders(), body: JSON.stringify({ answers: currentAnswers(), version: draft.version }), keepalive: true }).catch(function () {});
  });
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submitButton.focus(); }
  });
  const outlineLinks = Array.from(document.querySelectorAll("[data-question-link]"));
  const rootCards = cards.filter(function (card) { return !card.dataset.parentQuestion; });
  let currentQuestionId = "";
  let scrollFrame = null;
  function setActiveOutline(questionId) {
    let rootId = questionId;
    while (parentById.has(rootId)) rootId = parentById.get(rootId);
    for (const link of outlineLinks) {
      if (link.dataset.questionLink === rootId) {
        const changed = !link.hasAttribute("aria-current");
        link.setAttribute("aria-current", "step");
        // Follow the active section inside the rail only; never pull the page.
        if (changed && outline.open) {
          const scroller = link.closest(".outline-links");
          const bounds = scroller.getBoundingClientRect();
          const item = link.getBoundingClientRect();
          if (item.top < bounds.top) scroller.scrollTop += item.top - bounds.top - 4;
          else if (item.bottom > bounds.bottom) scroller.scrollTop += item.bottom - bounds.bottom + 4;
        }
      } else link.removeAttribute("aria-current");
    }
  }
  function updateActiveOutline() {
    scrollFrame = null;
    const visibleCards = rootCards.filter(function (card) { return !card.hidden; });
    let active = visibleCards[0];
    for (const card of visibleCards) {
      if (card.getBoundingClientRect().top <= 140) active = card;
      else break;
    }
    if (active) setActiveOutline(active.dataset.questionId);
  }
  function scheduleOutlineUpdate() {
    if (scrollFrame === null) scrollFrame = window.requestAnimationFrame(updateActiveOutline);
  }
  function navigateToQuestion(questionId, focusAnswer) {
    const card = document.getElementById("question-" + questionId);
    if (!card || card.hidden) return;
    currentQuestionId = questionId;
    if (outline && narrowViewport.matches) outline.open = false;
    const target = focusAnswer
      ? card.querySelector("input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)")
      : card.querySelector("h2");
    if (target) target.focus({ preventScroll: true });
    setActiveOutline(questionId);
    card.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  for (const link of outlineLinks) {
    link.addEventListener("click", function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigateToQuestion(link.dataset.questionLink, false);
    });
  }
  form.addEventListener("focusin", function (event) {
    const card = event.target.closest("[data-question]");
    if (card) {
      currentQuestionId = card.dataset.questionId;
      setActiveOutline(currentQuestionId);
    }
  });
  document.getElementById("next-unanswered").addEventListener("click", function () {
    const answers = currentAnswers();
    const active = activeQuestions(answers);
    const currentIndex = active.findIndex(function (question) { return question.id === currentQuestionId; });
    const ordered = active.slice(currentIndex + 1).concat(active.slice(0, currentIndex + 1));
    const next = ordered.find(function (question) { return !isComplete(question, answers); });
    if (next) navigateToQuestion(next.id, true);
  });
  window.addEventListener("scroll", scheduleOutlineUpdate, { passive: true });
  window.addEventListener("resize", scheduleOutlineUpdate);
  updateActiveOutline();
  try {
    await restoreDraft();
  } finally {
    updateVisibility();
    questionnaireFields.disabled = false;
    updateProgress();
  }
})();
`;

function renderDescription(description) {
  if (!description) return "";
  const text = escapeHtml(description);
  // Native disclosure keeps a long introduction available without dominating the page.
  return `<details class="introduction"><summary><span class="document-description hero-description">${text}</span><span class="description-toggle"><span class="read-more">Read full introduction</span><span class="read-less">Collapse introduction</span><span aria-hidden="true"> ↕</span></span></summary></details>`;
}

export function renderQuestionnaire(questionnaire, nonce) {
  const closed = questionnaire.status !== "open";
  // Custom branding is decorative only. Interactive colors always retain Mocha contrast.
  const accent = /^#[0-9a-f]{6}$/i.test(questionnaire.settings.accent_color || "")
    ? questionnaire.settings.accent_color : "#cba6f7";
  const initialVisibleCount = initialVisibleQuestionCount(questionnaire.questions);
  const mainQuestionLabel = `main ${questionnaire.questions.length === 1 ? "question" : "questions"}`;
  const nav = questionnaire.questions.map((question, index) => `
    <a href="#question-${escapeHtml(question.id)}" data-question-link="${escapeHtml(question.id)}"${index === 0 ? ' aria-current="step"' : ""}>
      <span class="outline-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="outline-title">${escapeHtml(question.title)}</span>
      <i aria-hidden="true">✓</i><span class="sr-only" data-section-state></span>
    </a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#181825">
  <title>${escapeHtml(questionnaire.title)}</title>
  <style nonce="${nonce}">
    ${QUESTIONNAIRE_CSS}
    :root { --custom-accent: ${accent}; }
    ${PROGRESS_WIDTH_CSS}
  </style>
</head>
<body>
  <a class="skip-link" href="#questionnaire-form">Skip to questions</a>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="mark">
        <svg class="brand-symbol" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M4 2h11l5 5v19H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2v6h6M8 13h8M8 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="brand-detail" d="m8 21 2 2 5-5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Questionnaire</span>
      </div>
      <div class="save-state" data-autosave-state data-state="idle" aria-live="polite">${closed ? "Closed" : "Ready — autosave on"}</div>
    </div>
  </header>
  <main>
    <div id="questionnaire-shell" class="layout">
      <nav class="question-nav" aria-label="Question navigation">
        <details class="outline-details" id="question-outline" open>
          <summary>Question outline</summary>
          <div class="outline-content">
            ${questionnaire.settings.show_progress ? `<div class="outline-progress"><div class="progress-track" role="progressbar" aria-label="Questionnaire progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-progress-bar data-percent="0"></span></div><div class="progress-copy"><span data-progress-text>0 of ${initialVisibleCount} shown answered</span></div></div>` : ""}
            <div class="outline-links">${nav}</div>
            ${closed ? "" : `<div class="outline-footer"><button type="button" class="next-unanswered" id="next-unanswered" disabled><span data-next-label>Next unanswered</span><span aria-hidden="true">↓</span></button></div>`}
          </div>
        </details>
        <p class="outline-note">${closed ? "Read-only questionnaire" : "Move freely between questions.<br>Your answers stay in this document."}</p>
      </nav>
      <div class="form-column">
        <header class="document-heading">
          <p class="eyebrow">${closed ? "Closed questionnaire" : "Your perspective matters"}</p>
          <h1>${escapeHtml(questionnaire.title)}</h1>
          ${renderDescription(questionnaire.description)}
          <div class="document-meta"><span>${questionnaire.questions.length} ${escapeHtml(mainQuestionLabel)}</span><span>No account required</span></div>
        </header>
        ${closed ? `<div class="closed-banner" role="status"><strong>This questionnaire is closed.</strong><br>It is no longer accepting new or updated responses.</div>` : ""}
        <div id="form-alert" class="form-alert" role="alert" tabindex="-1" hidden></div>
        ${closed ? "" : `<noscript><p class="closed-banner">JavaScript is required to autosave and submit this questionnaire.</p></noscript>`}
        <form id="questionnaire-form" method="post" novalidate>
          <fieldset${closed ? " disabled" : ' id="questionnaire-fields" disabled'}>
            ${questionnaire.questions.map((question, index) => renderQuestion(question, index)).join("")}
            ${closed ? "" : `<div class="submit-panel"><div class="submit-kicker" id="respondent-title">Who is submitting?</div><p>Your answers are saved to the server while you are online and autosave without identity. Your identity is attached only when you submit.</p><div class="respondent-fields" role="group" aria-labelledby="respondent-title"><label><span>Name <b aria-hidden="true">*</b></span><input class="text-control" type="text" name="respondent_name" autocomplete="name" maxlength="160" required></label><label><span>Email <b aria-hidden="true">*</b></span><input class="text-control" type="email" name="respondent_email" autocomplete="email" inputmode="email" maxlength="320" required></label></div><button class="submit-button" id="submit-response" type="submit">${escapeHtml(questionnaire.settings.submit_label)}<span aria-hidden="true">↗</span></button></div>`}
          </fieldset>
        </form>
        <p class="privacy-note">No account is required. Your submitted name and email are stored with your answers so the questionnaire owner can identify your response.</p>
      </div>
    </div>
    <section id="completion-screen" class="completion" tabindex="-1" hidden aria-labelledby="completion-title">
      <div class="completion-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">Response received</p>
      <h2 id="completion-title">Thank you</h2>
      <p>${escapeHtml(questionnaire.settings.completion_message)}</p>
    </section>
  </main>
  <script type="application/json" id="questionnaire-data">${safeJson(questionnaire)}</script>
  <script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

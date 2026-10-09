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

const FORMAT_LABELS = { jpeg: "JPEG", png: "PNG", webp: "WebP" };
const FORMAT_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
// Mirrors UPLOAD_LIMITS retention in attachments.js.
const UPLOAD_RETENTION_COPY = "Images are private to the questionnaire owner, and camera and location metadata is removed. Unsubmitted drafts with images are deleted after 7 days without activity, and removed images are deleted after 24 hours.";
const ROW_TOKEN = "__ROWID__";

function listWords(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

function formatMegabytes(bytes) {
  const value = bytes / (1024 * 1024);
  return Number.isInteger(value) ? `${value} MB` : value >= 1 ? `${value.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function hasQuestionType(questions, type) {
  return questions.some((question) => question.type === type
    || (question.fields || []).some((field) => field.type === type)
    || hasQuestionType(question.children || [], type));
}

function renderUpload(question, { describedBy, titleId, groupId = question.id, fieldId = "" }) {
  const id = escapeHtml(question.id);
  const { formats, min_files: minFiles, max_files: maxFiles, max_bytes: maxBytes } = question.settings;
  const minimum = Math.max(question.required ? 1 : 0, minFiles);
  const hintId = `upload-hint-${id}`;
  const hint = `${listWords(formats.map((format) => FORMAT_LABELS[format]))} · up to ${formatMegabytes(maxBytes)} · ${maxFiles === 1 ? "1 image" : `up to ${maxFiles} images`}`;
  return `<div class="upload-field" data-upload="${id}" data-upload-question="${escapeHtml(groupId)}" data-upload-field="${escapeHtml(fieldId)}" data-min-files="${minimum}" data-max-files="${maxFiles}" data-max-bytes="${maxBytes}" data-formats="${formats.join(",")}">
    <div class="upload-picker"><input class="upload-input" type="file" id="q-${id}" accept="${formats.map((format) => FORMAT_TYPES[format]).join(",")}"${maxFiles > 1 ? " multiple" : ""} aria-labelledby="${titleId}" aria-describedby="${hintId} ${describedBy}"><p class="field-hint" id="${hintId}">${hint}</p></div>
    <ul class="upload-list" data-upload-list></ul>
  </div>`;
}

function renderRowField(group, field) {
  const scoped = `${group.id}${ROW_TOKEN}${field.id}`;
  const id = escapeHtml(scoped);
  const titleId = `question-title-${id}`;
  const descriptionId = field.description ? `question-description-${id}` : "";
  return `<div class="row-field" data-row-field="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}">
      <div class="row-field-label"><span class="row-field-title" id="${titleId}">${escapeHtml(field.title)}${field.required ? `<span class="required" aria-hidden="true">*</span><span class="sr-only"> (Required)</span>` : ""}</span>${field.description ? `<span class="row-field-description" id="${descriptionId}">${escapeHtml(field.description)}</span>` : ""}</div>
      ${renderControl({ ...field, id: scoped }, { groupId: group.id, fieldId: field.id })}
      <p class="field-error" id="question-error-${id}" data-error-for="${id}" aria-live="polite"></p>
    </div>`;
}

function renderRows(question, { describedBy, titleId }) {
  const id = escapeHtml(question.id);
  const { min_rows: minRows, max_rows: maxRows, add_label: addLabel } = question.settings;
  // An optional group may stay empty; min_rows then applies only once a row exists.
  const minimum = question.required ? Math.max(1, minRows) : minRows;
  const rows = (count) => `${count} ${count === 1 ? "row" : "rows"}`;
  const limits = question.required
    ? `Add ${minimum === maxRows ? rows(minimum) : `${minimum} to ${rows(maxRows)}`}.`
    : minimum > 0 ? `Optional. If you add rows, add at least ${minimum}. Up to ${rows(maxRows)}.` : `Add up to ${rows(maxRows)}.`;
  return `<div class="row-group" data-rows="${id}" data-min-rows="${minimum}" data-required="${question.required ? "true" : "false"}" data-max-rows="${maxRows}" role="group" aria-labelledby="${titleId}" aria-describedby="${describedBy}">
    <ol class="row-list" data-row-list></ol>
    <p class="sr-only" aria-live="polite" data-rows-status></p>
    <div class="row-footer"><button type="button" class="add-row" data-add-row>${escapeHtml(addLabel)}</button><p class="field-hint" data-rows-hint>${limits} Use the arrows to reorder rows.</p></div>
    <template data-row-template="${id}"><li class="row-item" data-row-id="${ROW_TOKEN}">
      <div class="row-head"><span class="row-title" data-row-title>Row</span><span class="row-actions"><button type="button" class="row-action" data-row-up aria-label="Move row up">↑</button><button type="button" class="row-action" data-row-down aria-label="Move row down">↓</button><button type="button" class="row-action row-remove" data-row-remove>Remove</button></span></div>
      <div class="row-fields">${question.fields.map((field) => renderRowField(question, field)).join("")}</div>
    </li></template>
  </div>`;
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

function renderControl(question, scope = {}) {
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
    case "file_upload": return renderUpload(question, { describedBy, titleId, ...scope });
    case "repeatable_rows": return renderRows(question, { describedBy, titleId });
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
  file_upload: "Image upload", repeatable_rows: "Repeatable rows",
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
  // Row fields reuse every control; their names are "<group>__<row id>__<field>".
  function scopedName(group, rowId, field) { return group.id + "__" + rowId + "__" + field.id; }
  function uploadField(name) { return form.querySelector('[data-upload="' + CSS.escape(name) + '"]'); }
  function uploadIds(field) { try { return JSON.parse(field.dataset.attachments || "[]"); } catch { return []; } }
  function readValue(question, name) {
    if (question.type === "multiple_choice") {
      return Array.from(form.querySelectorAll('input[name="' + CSS.escape(name) + '"]:checked')).map(function (input) { return input.value; });
    }
    if (question.type === "consent") {
      const control = form.elements.namedItem(name);
      return control ? control.checked : undefined;
    }
    if (["single_choice", "yes_no", "rating", "scale"].includes(question.type)) {
      const input = selected(name);
      if (input) return ["rating", "scale"].includes(question.type) ? Number(input.value) : input.value;
      return undefined;
    }
    if (question.type === "ranking") {
      const ranking = form.querySelector('[data-ranking="' + CSS.escape(name) + '"]');
      if (ranking && ranking.dataset.rankingAnswered === "true") return Array.from(ranking.querySelectorAll("li")).map(function (item) { return item.dataset.value; });
      return undefined;
    }
    if (question.type === "matrix") {
      const value = {};
      for (const row of question.rows) {
        const input = selected(name + "__" + row.value);
        if (input) value[row.value] = input.value;
      }
      return value;
    }
    if (question.type === "file_upload") {
      const field = uploadField(name);
      return field ? uploadIds(field) : undefined;
    }
    if (question.type === "repeatable_rows") {
      const group = rowGroup(question.id);
      if (!group) return undefined;
      return rowItems(group).map(function (item) {
        const values = {};
        for (const field of question.fields) {
          const value = readValue(field, scopedName(question, item.dataset.rowId, field));
          if (value !== undefined) values[field.id] = value;
        }
        return { row_id: item.dataset.rowId, values: values };
      });
    }
    const control = form.elements.namedItem(name);
    if (control && control.value !== "") return question.type === "number" ? Number(control.value) : control.value;
    return undefined;
  }
  function rawAnswers() {
    const answers = {};
    for (const question of flatQuestions) {
      const value = readValue(question, question.id);
      if (value !== undefined) answers[question.id] = value;
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
    // Re-apply limits that visibility toggling would otherwise re-enable.
    for (const group of form.querySelectorAll("[data-rows]")) renumberRows(group);
    for (const field of form.querySelectorAll("[data-upload]")) setUploadIds(field, uploadIds(field));
  }
  function isComplete(question, answers) {
    const value = answers[question.id];
    if (question.type === "consent") return value === true;
    if (question.type === "file_upload") {
      const minimum = Math.max(1, question.settings.min_files);
      return Array.isArray(value) && value.length >= minimum && value.length <= question.settings.max_files;
    }
    if (question.type === "repeatable_rows") {
      if (!Array.isArray(value) || value.length < Math.max(1, question.settings.min_rows)) return false;
      return value.every(function (row) {
        return question.fields.every(function (field) { return !field.required || isComplete(field, row.values); });
      });
    }
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
  // Server errors name "<question>: …", "<question>[<row>]: …", or "<question>[<row>].<field>: …".
  function errorTarget(message) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\[(\d+)\](?:\.([A-Za-z][A-Za-z0-9_-]*))?)?: ([\s\S]*)$/.exec(String(message));
    if (!match) return null;
    const question = questionById.get(match[1]);
    if (!question) return null;
    const target = { question: question, text: match[4], errorId: question.id, scope: null, label: question.title };
    if (match[2] && question.type === "repeatable_rows") {
      const rowNumber = Number(match[2]);
      const item = rowItems(rowGroup(question.id))[rowNumber - 1];
      target.label = question.title + ", row " + rowNumber;
      if (item && match[3]) {
        const field = question.fields.find(function (candidate) { return candidate.id === match[3]; });
        target.errorId = scopedName(question, item.dataset.rowId, { id: match[3] });
        target.scope = item.querySelector('[data-row-field="' + CSS.escape(match[3]) + '"]');
        if (field) target.label += ", " + field.title;
      } else {
        target.scope = item || null;
        target.text = "Row " + rowNumber + ": " + target.text;
      }
    }
    return target;
  }
  function showError(message) {
    const target = errorTarget(message);
    alertBox.textContent = target ? target.label + ": " + target.text : message;
    alertBox.hidden = false;
    const id = target ? target.question.id : String(message).split(":", 1)[0];
    const fieldError = target ? document.querySelector('[data-error-for="' + CSS.escape(target.errorId) + '"]') : null;
    const card = document.getElementById("question-" + id);
    if (fieldError) fieldError.textContent = target.text;
    if (card) {
      card.setAttribute("aria-invalid", "true");
      const firstInvalid = (target && target.scope ? target.scope : card).querySelector("input:not(:disabled), textarea, select, button:not(:disabled)");
      if (firstInvalid) firstInvalid.focus();
      card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } else {
      alertBox.focus();
    }
  }
  async function decode(response) {
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(body.error || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
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
  function writeValue(question, name, value) {
    if (question.type === "multiple_choice") {
      for (const input of form.querySelectorAll('input[name="' + CSS.escape(name) + '"]')) input.checked = value.includes(input.value);
    } else if (question.type === "consent") {
      form.elements.namedItem(name).checked = value === true;
    } else if (["single_choice", "yes_no", "rating", "scale"].includes(question.type)) {
      const input = form.querySelector('input[name="' + CSS.escape(name) + '"][value="' + CSS.escape(String(value)) + '"]');
      if (input) input.checked = true;
    } else if (question.type === "ranking" && Array.isArray(value)) {
      const ranking = form.querySelector('[data-ranking="' + CSS.escape(name) + '"]');
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
    } else if (question.type === "file_upload" && Array.isArray(value)) {
      const field = uploadField(name);
      if (field) for (const id of value) addStoredUpload(field, id);
    } else if (question.type === "repeatable_rows" && Array.isArray(value)) {
      const group = rowGroup(question.id);
      for (const item of rowItems(group)) item.remove();
      for (const row of value) {
        const item = addRow(group, row.row_id);
        for (const field of question.fields) {
          if (row.values && row.values[field.id] !== undefined) writeValue(field, scopedName(question, row.row_id, field), row.values[field.id]);
        }
        void item;
      }
      renumberRows(group);
    } else {
      const control = form.elements.namedItem(name);
      if (control) control.value = value;
    }
  }
  function hydrate(answers) {
    for (const question of flatQuestions) {
      if (answers[question.id] !== undefined) writeValue(question, question.id, answers[question.id]);
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
      for (const id of Object.keys(restored.attachments || {})) attachmentMeta.set(id, restored.attachments[id]);
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
    for (const field of form.querySelectorAll("[data-upload]")) {
      if (field.closest("[data-question]")?.hidden) continue;
      const minimum = Number(field.dataset.minFiles || 0);
      const count = uploadIds(field).length;
      const message = count < minimum ? "Attach at least " + minimum + (minimum === 1 ? " image." : " images.") : "";
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(field.dataset.upload) + '"]');
      if (fieldError && message) fieldError.textContent = message;
      if (message) { field.setAttribute("aria-invalid", "true"); valid = false; } else field.removeAttribute("aria-invalid");
    }
    for (const group of form.querySelectorAll("[data-rows]")) {
      if (group.closest("[data-question]")?.hidden) continue;
      const minimum = Number(group.dataset.minRows || 0);
      const count = rowItems(group).length;
      const applies = group.dataset.required === "true" || count > 0;
      const message = applies && count < minimum ? "Add at least " + minimum + (minimum === 1 ? " row." : " rows.") : "";
      const fieldError = document.querySelector('[data-error-for="' + CSS.escape(group.dataset.rows) + '"]');
      if (fieldError && message) fieldError.textContent = message;
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
  // Delegated so rankings inside rows added later behave like top-level ones.
  form.addEventListener("click", function (event) {
    const button = event.target.closest("[data-rank-up], [data-rank-down]");
    if (!button) return;
    const ranking = button.closest("[data-ranking]");
    const item = button.closest("li");
    if (button.hasAttribute("data-rank-up") && item.previousElementSibling) item.parentElement.insertBefore(item, item.previousElementSibling);
    if (button.hasAttribute("data-rank-down") && item.nextElementSibling) item.parentElement.insertBefore(item.nextElementSibling, item);
    ranking.dataset.rankingAnswered = "true";
    const fieldError = document.querySelector('[data-error-for="' + CSS.escape(ranking.dataset.ranking) + '"]');
    if (fieldError) fieldError.textContent = "";
    renumberRanking(item.parentElement, item);
    updateProgress(); scheduleSave();
  });
  const ROW_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function rowGroup(id) { return form.querySelector('[data-rows="' + CSS.escape(id) + '"]'); }
  function rowItems(group) { return group ? Array.from(group.querySelector("[data-row-list]").children) : []; }
  function newRowId(group) {
    const taken = new Set(rowItems(group).map(function (item) { return item.dataset.rowId; }));
    let id = "";
    do {
      const bytes = new Uint8Array(10);
      window.crypto.getRandomValues(bytes);
      id = "r" + Array.from(bytes, function (byte) { return ROW_ID_ALPHABET[byte % ROW_ID_ALPHABET.length]; }).join("");
    } while (taken.has(id));
    return id;
  }
  function renumberRows(group) {
    const items = rowItems(group);
    // Only a required group keeps its minimum rows; an optional one can always return to zero.
    const minimum = group.dataset.required === "true" ? Number(group.dataset.minRows || 0) : 0;
    const maximum = Number(group.dataset.maxRows || 50);
    const disabled = Boolean(group.closest("[data-question]")?.hidden);
    items.forEach(function (item, index) {
      item.querySelector("[data-row-title]").textContent = "Row " + (index + 1);
      const up = item.querySelector("[data-row-up]");
      const down = item.querySelector("[data-row-down]");
      const remove = item.querySelector("[data-row-remove]");
      up.disabled = disabled || index === 0;
      down.disabled = disabled || index === items.length - 1;
      remove.disabled = disabled || items.length <= minimum;
      up.setAttribute("aria-label", "Move row " + (index + 1) + " up");
      down.setAttribute("aria-label", "Move row " + (index + 1) + " down");
      remove.setAttribute("aria-label", "Remove row " + (index + 1));
    });
    group.querySelector("[data-add-row]").disabled = disabled || items.length >= maximum;
  }
  function addRow(group, rowId) {
    const template = group.querySelector("template[data-row-template]");
    const holder = document.createElement("template");
    holder.innerHTML = template.innerHTML.split("__ROWID__").join("__" + rowId + "__");
    const item = holder.content.firstElementChild;
    item.dataset.rowId = rowId;
    group.querySelector("[data-row-list]").appendChild(item);
    renumberRows(group);
    return item;
  }
  function announceRows(group, message) {
    const status = group.querySelector("[data-rows-status]");
    if (status) status.textContent = message;
  }
  form.addEventListener("click", function (event) {
    const button = event.target.closest("[data-add-row], [data-row-up], [data-row-down], [data-row-remove]");
    if (!button || button.disabled) return;
    const group = button.closest("[data-rows]");
    if (button.hasAttribute("data-add-row")) {
      const item = addRow(group, newRowId(group));
      const first = item.querySelector("input, textarea, select");
      if (first) first.focus();
      announceRows(group, "Row " + rowItems(group).length + " added.");
    } else {
      const item = button.closest("[data-row-id]");
      const items = rowItems(group);
      const index = items.indexOf(item);
      if (button.hasAttribute("data-row-remove")) {
        for (const upload of item.querySelectorAll("[data-upload]")) abortUploads(upload);
        const next = items[index + 1] || items[index - 1];
        item.remove();
        renumberRows(group);
        const focusTarget = next ? next.querySelector("[data-row-remove]:not(:disabled), [data-row-up]:not(:disabled), [data-row-down]:not(:disabled)") : group.querySelector("[data-add-row]");
        (focusTarget || group.querySelector("[data-add-row]")).focus();
        announceRows(group, "Row " + (index + 1) + " removed. " + rowItems(group).length + " rows remain.");
      } else {
        const up = button.hasAttribute("data-row-up");
        if (up && item.previousElementSibling) item.parentElement.insertBefore(item, item.previousElementSibling);
        if (!up && item.nextElementSibling) item.parentElement.insertBefore(item.nextElementSibling, item);
        renumberRows(group);
        const position = rowItems(group).indexOf(item) + 1;
        const same = item.querySelector(up ? "[data-row-up]" : "[data-row-down]");
        (same.disabled ? item.querySelector(up ? "[data-row-down]" : "[data-row-up]") : same).focus();
        announceRows(group, "Row moved to position " + position + " of " + rowItems(group).length + ".");
      }
    }
    clearErrors(); updateProgress(); scheduleSave();
  });

  // Uploads: a short-lived capability per file, then a raw XHR body so progress and cancel work.
  const attachmentMeta = new Map();
  const activeUploads = new Set();
  const FORMAT_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  function setUploadIds(field, ids) {
    field.dataset.attachments = JSON.stringify(ids);
    const input = field.querySelector(".upload-input");
    const pending = field.querySelectorAll('[data-upload-state="uploading"]').length;
    if (input) input.disabled = Boolean(field.closest("[data-question]")?.hidden) || ids.length + pending >= Number(field.dataset.maxFiles);
  }
  function uploadMessage(field, message) {
    const error = document.querySelector('[data-error-for="' + CSS.escape(field.dataset.upload) + '"]');
    if (error) error.textContent = message || "";
  }
  function uploadItem(field, name) {
    const item = document.createElement("li");
    item.className = "upload-item";
    const preview = document.createElement("img");
    preview.className = "upload-thumb";
    preview.alt = "";
    const copy = document.createElement("span");
    copy.className = "upload-copy";
    const title = document.createElement("strong");
    title.textContent = name;
    const detail = document.createElement("small");
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute("aria-label", "Upload progress for " + name);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "upload-action";
    copy.append(title, detail, progress);
    item.append(preview, copy, action);
    field.querySelector("[data-upload-list]").appendChild(item);
    return { item: item, preview: preview, detail: detail, progress: progress, action: action };
  }
  function showStored(parts, field, id, meta) {
    parts.item.dataset.uploadState = "stored";
    parts.item.dataset.attachmentId = id;
    parts.progress.remove();
    parts.detail.textContent = meta ? meta.width + " × " + meta.height + " · " + formatBytes(meta.bytes) + " · saved privately" : "Saved privately";
    parts.action.textContent = "Remove";
    parts.action.setAttribute("aria-label", "Remove " + (meta ? meta.filename : "image"));
    parts.action.onclick = function () {
      setUploadIds(field, uploadIds(field).filter(function (item) { return item !== id; }));
      if (parts.preview.src) URL.revokeObjectURL(parts.preview.src);
      parts.item.remove();
      uploadMessage(field, "Image removed. It will be deleted after 24 hours.");
      setUploadIds(field, uploadIds(field));
      field.querySelector(".upload-input").focus();
      clearErrors(); updateProgress(); scheduleSave();
    };
  }
  function addStoredUpload(field, id) {
    if (uploadIds(field).includes(id)) return;
    const meta = attachmentMeta.get(id);
    const parts = uploadItem(field, meta ? meta.filename : "Image");
    showStored(parts, field, id, meta);
    setUploadIds(field, uploadIds(field).concat(id));
    if (!draft) return;
    fetch(api("/responses/" + draft.response_id + "/attachments/" + id), { headers: { "X-Questionnaire-Edit-Token": draft.edit_token } })
      .then(function (response) { if (!response.ok) throw new Error("preview"); return response.blob(); })
      .then(function (blob) { parts.preview.src = URL.createObjectURL(blob); parts.preview.alt = meta ? meta.filename : ""; })
      .catch(function () { parts.item.dataset.previewUnavailable = "true"; });
  }
  function abortUploads(field) {
    for (const upload of Array.from(activeUploads)) if (upload.field === field) upload.cancel();
  }
  async function startUpload(field, file) {
    const parts = uploadItem(field, file.name);
    parts.item.dataset.uploadState = "uploading";
    parts.preview.src = URL.createObjectURL(file);
    parts.detail.textContent = "Preparing " + formatBytes(file.size) + "…";
    parts.action.textContent = "Cancel";
    parts.action.setAttribute("aria-label", "Cancel uploading " + file.name);
    const upload = { field: field, xhr: new XMLHttpRequest() };
    activeUploads.add(upload);
    setUploadIds(field, uploadIds(field));
    // Settles exactly once: abort() on an opened-but-unsent request fires no abort event, so cancel cleans up itself.
    let settled = false;
    const cancel = function () {
      if (settled) return;
      settled = true;
      upload.xhr.abort();
      URL.revokeObjectURL(parts.preview.src);
      parts.item.remove();
      if (field.isConnected) uploadMessage(field, "Upload of " + file.name + " cancelled.");
      finish();
    };
    parts.action.onclick = cancel;
    upload.cancel = cancel;
    const finish = function () {
      activeUploads.delete(upload);
      setUploadIds(field, uploadIds(field));
      setStatus(activeUploads.size ? "Uploading images…" : dirty ? "Unsaved changes" : "All changes saved", activeUploads.size ? "saving" : dirty ? "dirty" : "saved");
    };
    const fail = function (message) {
      if (settled) return;
      settled = true;
      parts.item.dataset.uploadState = "error";
      parts.progress.remove();
      parts.detail.textContent = message;
      parts.action.textContent = "Dismiss";
      parts.action.setAttribute("aria-label", "Dismiss failed upload of " + file.name);
      parts.action.onclick = function () { URL.revokeObjectURL(parts.preview.src); parts.item.remove(); field.querySelector(".upload-input").focus(); };
      uploadMessage(field, file.name + ": " + message);
      finish();
    };
    try {
      setStatus("Uploading images…", "saving");
      await ensureDraft();
      const row = field.closest("[data-row-id]");
      const target = { question_id: field.dataset.uploadQuestion };
      if (row) { target.row_id = row.dataset.rowId; target.field_id = field.dataset.uploadField; }
      const grant = await decode(await fetch(api("/responses/" + draft.response_id + "/attachments/capability"), { method: "POST", headers: requestHeaders(), body: JSON.stringify(target) }));
      if (settled) return;
      const params = new URLSearchParams({ question_id: target.question_id, filename: file.name, upload_expires: String(grant.upload_expires), upload_signature: grant.upload_signature });
      if (target.row_id) { params.set("row_id", target.row_id); params.set("field_id", target.field_id); }
      const xhr = upload.xhr;
      xhr.open("POST", api("/responses/" + draft.response_id + "/attachments") + "&" + params.toString());
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Questionnaire-Edit-Token", draft.edit_token);
      xhr.responseType = "json";
      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable) return;
        parts.progress.value = Math.round((event.loaded / event.total) * 100);
        parts.detail.textContent = "Uploading " + parts.progress.value + "% of " + formatBytes(file.size);
      };
      xhr.onload = function () {
        if (settled) return;
        const body = xhr.response || {};
        if (xhr.status !== 201) { fail(body.error || "The upload failed."); return; }
        settled = true;
        attachmentMeta.set(body.attachment_id, body);
        if (!field.isConnected) { finish(); return; }
        showStored(parts, field, body.attachment_id, body);
        setUploadIds(field, uploadIds(field).concat(body.attachment_id));
        uploadMessage(field, "");
        finish();
        clearErrors(); updateProgress(); scheduleSave();
      };
      xhr.onerror = function () { fail(navigator.onLine ? "The upload failed. Try again." : "You are offline. Try again when connected."); };
      xhr.onabort = cancel;
      xhr.send(file);
    } catch (error) {
      fail(error.message);
    }
  }
  function handleFiles(input) {
    const field = input.closest("[data-upload]");
    const files = Array.from(input.files || []);
    input.value = "";
    const allowed = field.dataset.formats.split(",").map(function (format) { return FORMAT_TYPES[format]; });
    const maximum = Number(field.dataset.maxFiles);
    const maxBytes = Number(field.dataset.maxBytes);
    const messages = [];
    for (const file of files) {
      const used = uploadIds(field).length + field.querySelectorAll('[data-upload-state="uploading"]').length;
      if (used >= maximum) { messages.push("You can attach up to " + maximum + (maximum === 1 ? " image." : " images.")); break; }
      if (!allowed.includes(file.type)) { messages.push(file.name + " is not an accepted image type."); continue; }
      if (file.size > maxBytes) { messages.push(file.name + " is larger than " + formatBytes(maxBytes) + "."); continue; }
      startUpload(field, file);
    }
    uploadMessage(field, messages.join(" "));
  }
  const authenticationType = definition.authentication_type || "anonymous";
  const identityDialog = document.getElementById("identity-dialog");
  const identityForm = document.getElementById("identity-form");
  const identityError = document.getElementById("identity-error");
  const identityStatus = document.getElementById("identity-status");
  const resendButton = document.getElementById("resend-code");
  let verified = null;
  let sentTo = "";
  let resendTimer = null;
  function setSubmitBusy(busy) {
    submitButton.disabled = busy;
    submitButton.textContent = busy ? "Submitting…" : definition.settings.submit_label;
  }
  async function prepareDraft() {
    clearTimeout(saveTimer);
    if (saving) await saving;
    await ensureDraft();
    if (dirty) await save({ force: true });
  }
  async function finalSubmit(extra) {
    await prepareDraft();
    const result = await decode(await fetch(api("/responses/" + draft.response_id + "/submit"), {
      method: "POST", headers: requestHeaders(), body: JSON.stringify(Object.assign({ answers: currentAnswers(), version: draft.version }, extra)),
    }));
    sessionRemove(storageKey); dirty = false;
    if (identityDialog && identityDialog.open) identityDialog.close();
    document.getElementById("questionnaire-shell").hidden = true;
    const completion = document.getElementById("completion-screen");
    completion.hidden = false; completion.focus();
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setStatus("Response submitted", "saved");
    return result;
  }
  function identityValue(name) { return String(identityForm.elements.namedItem(name).value || "").trim(); }
  function respondentValue() { return { name: identityValue("respondent_name"), email: identityValue("respondent_email") }; }
  function setIdentityError(message) {
    identityError.textContent = message || "";
    identityError.hidden = !message;
  }
  function setIdentityStatus(message) { if (identityStatus) identityStatus.textContent = message || ""; }
  function showStep(step) {
    for (const section of identityForm.querySelectorAll("[data-step]")) section.hidden = section.dataset.step !== step;
    const focusTarget = identityForm.querySelector('[data-step="' + step + '"] input');
    if (focusTarget) focusTarget.focus();
  }
  function setDialogBusy(busy) {
    for (const button of identityForm.querySelectorAll("button[data-busy-label]")) {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
      button.disabled = busy;
      button.textContent = busy ? button.dataset.busyLabel : button.dataset.idleLabel;
    }
    if (!busy && resendTimer) resendButton.disabled = true;
  }
  function startResendCountdown(seconds) {
    clearInterval(resendTimer);
    let remaining = seconds;
    const tick = function () {
      if (remaining <= 0) {
        clearInterval(resendTimer); resendTimer = null;
        resendButton.disabled = false; resendButton.textContent = "Resend code";
        return;
      }
      resendButton.disabled = true;
      resendButton.textContent = "Resend code in " + remaining + "s";
      remaining -= 1;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }
  function handleSubmitError(error) {
    if (errorTarget(error.message)) {
      identityDialog.close();
      setSubmitBusy(false);
      showError(error.message);
      return;
    }
    setIdentityError(error.message);
  }
  function openIdentityDialog() {
    setIdentityError("");
    if (!identityDialog.open) identityDialog.showModal();
    showStep(verified || sentTo ? "code" : "identity");
    if (!verified && !sentTo) identityForm.elements.namedItem("respondent_name").focus();
  }
  async function sendCode() {
    if (!identityForm.elements.namedItem("respondent_name").reportValidity() || !identityForm.elements.namedItem("respondent_email").reportValidity()) return;
    const respondent = respondentValue();
    setIdentityError(""); setDialogBusy(true);
    try {
      await prepareDraft();
      const sent = await decode(await fetch(api("/responses/" + draft.response_id + "/verification"), {
        method: "POST", headers: requestHeaders(), body: JSON.stringify({ respondent: respondent }),
      }));
      const resent = sentTo === sent.email;
      sentTo = sent.email; verified = null;
      identityForm.elements.namedItem("verification_code").value = "";
      for (const target of identityForm.querySelectorAll("[data-destination]")) target.textContent = sent.email;
      setIdentityStatus(resent ? "We queued a new verification email. Earlier codes no longer work." : "");
      showStep("code");
      startResendCountdown(Math.max(1, Math.round((Date.parse(sent.resend_available_at) - Date.now()) / 1000)) || 60);
    } catch (error) {
      setIdentityError(error.message);
    } finally {
      setDialogBusy(false);
    }
  }
  if (identityForm) {
    // Enter submits the visible step's primary action, never the first (Cancel) button in tree order.
    identityForm.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
      event.preventDefault();
      const primary = identityForm.querySelector("[data-step]:not([hidden]) .dialog-button.primary");
      if (primary && !primary.disabled) primary.click();
    });
    identityForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const action = event.submitter ? event.submitter.value : "";
      if (action === "cancel") { identityDialog.close(); return; }
      if (action === "change-email") {
        sentTo = ""; verified = null; setIdentityStatus(""); setIdentityError("");
        showStep("identity");
        identityForm.elements.namedItem("respondent_email").select();
        return;
      }
      if (authenticationType === "self_report") {
        if (!identityForm.reportValidity()) return;
        setIdentityError(""); setDialogBusy(true);
        try { await finalSubmit({ respondent: respondentValue() }); }
        catch (error) { handleSubmitError(error); }
        finally { setDialogBusy(false); }
        return;
      }
      if (action === "send-code" || action === "resend-code") { await sendCode(); return; }
      if (action === "verify") {
        const codeInput = identityForm.elements.namedItem("verification_code");
        if (!verified && !codeInput.reportValidity()) return;
        setIdentityError(""); setDialogBusy(true);
        try {
          await prepareDraft();
          if (!verified) {
            const confirmed = await decode(await fetch(api("/responses/" + draft.response_id + "/verification/confirm"), {
              method: "POST", headers: requestHeaders(), body: JSON.stringify({ email: sentTo, code: codeInput.value.trim() }),
            }));
            verified = { email: confirmed.email, proof: confirmed.verification_proof };
          }
          await finalSubmit({ respondent: { name: identityValue("respondent_name"), email: verified.email }, verification_proof: verified.proof });
        } catch (error) {
          handleSubmitError(error);
        } finally {
          setDialogBusy(false);
        }
      }
    });
    identityDialog.addEventListener("close", function () {
      if (document.getElementById("completion-screen").hidden) {
        setSubmitBusy(false);
        setStatus(dirty ? "Unsaved changes" : "Draft kept — submit when ready", dirty ? "dirty" : "saved");
      }
    });
  }
  form.addEventListener("input", function (event) {
    if (event.target.matches(".upload-input")) return;
    updateVisibility(); clearErrors(); validateSelections(); updateProgress(); scheduleSave();
  });
  form.addEventListener("change", function (event) {
    if (event.target.matches(".upload-input")) { handleFiles(event.target); return; }
    updateVisibility(); clearErrors(); validateSelections(); updateProgress(); scheduleSave();
  });
  form.addEventListener("submit", async function (event) {
    event.preventDefault(); clearErrors();
    if (activeUploads.size) { showError("Wait for image uploads to finish before submitting."); return; }
    const selectionsValid = validateSelections();
    const nativeValid = form.reportValidity();
    if (!selectionsValid || !nativeValid) {
      const firstInvalid = form.querySelector(":invalid") || document.querySelector('[data-ranking-required="true"][data-ranking-answered="false"] button:not(:disabled)');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    if (authenticationType === "anonymous") {
      setSubmitBusy(true);
      try {
        await finalSubmit({});
      } catch (error) {
        showError(error.message); setSubmitBusy(false);
      }
      return;
    }
    openIdentityDialog();
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
  for (const group of form.querySelectorAll('[data-rows][data-required="true"]')) {
    const minimum = Number(group.dataset.minRows || 0);
    while (rowItems(group).length < minimum) addRow(group, newRowId(group));
  }
  try {
    await restoreDraft();
  } finally {
    updateVisibility();
    questionnaireFields.disabled = false;
    for (const group of form.querySelectorAll("[data-rows]")) renumberRows(group);
    for (const field of form.querySelectorAll("[data-upload]")) setUploadIds(field, uploadIds(field));
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

const SUBMIT_COPY = {
  anonymous: "Your answers are saved to the server while you are online. This questionnaire is anonymous: no name or email is collected.",
  self_report: "Your answers are saved to the server while you are online, without your identity. You will confirm your name and email when you submit.",
  email_verified: "Your answers are saved to the server while you are online, without your identity. When you submit, you will confirm your name and verify your email with a one-time code.",
};
const PRIVACY_COPY = {
  anonymous: "No account is required. Your response is not linked to a name or email unless you type one into an answer.",
  self_report: "No account is required. The name and email you enter at submission are stored with your answers so the questionnaire owner can identify your response.",
  email_verified: "No account is required. The name you enter and your verified email are stored with your answers so the questionnaire owner can identify your response.",
};

function renderIdentityDialog(questionnaire, mode) {
  if (mode === "anonymous") return "";
  const verifiedMode = mode === "email_verified";
  const submitLabel = escapeHtml(questionnaire.settings.submit_label);
  const identityStep = `<div data-step="identity">
      <div class="identity-fields"><label><span>Name <b aria-hidden="true">*</b></span><input class="text-control" type="text" name="respondent_name" autocomplete="name" maxlength="160" required></label><label><span>Email <b aria-hidden="true">*</b></span><input class="text-control" type="email" name="respondent_email" autocomplete="email" inputmode="email" maxlength="320" required></label></div>
      <div class="dialog-actions"><button type="submit" class="dialog-button" value="cancel" formnovalidate>Cancel</button>${verifiedMode
        ? `<button type="submit" class="dialog-button primary" value="send-code" data-busy-label="Sending…">Send code</button>`
        : `<button type="submit" class="dialog-button primary" value="submit" data-busy-label="Submitting…">${submitLabel}</button>`}</div>
    </div>`;
  const codeStep = verifiedMode ? `<div data-step="code" hidden>
      <p class="dialog-copy">We queued a verification email to <strong data-destination></strong>. Our mail provider accepted it, but delivery is not guaranteed.</p>
      <ul class="dialog-notes"><li>Email can take a few minutes to arrive.</li><li>If you don't see it, check your spam or junk folder.</li><li>The code expires in 10 minutes and works once.</li></ul>
      <label class="code-field"><span>Verification code</span><input class="text-control" type="text" name="verification_code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <p class="dialog-status" id="identity-status" role="status" aria-live="polite"></p>
      <div class="dialog-actions split"><span><button type="submit" class="dialog-link" value="change-email" formnovalidate>Change email</button><button type="submit" class="dialog-link" id="resend-code" value="resend-code" formnovalidate disabled>Resend code</button></span><span><button type="submit" class="dialog-button" value="cancel" formnovalidate>Cancel</button><button type="submit" class="dialog-button primary" value="verify" data-busy-label="Submitting…">Verify and submit</button></span></div>
    </div>` : "";
  const intro = verifiedMode
    ? "Your name is shown to the questionnaire owner as you enter it. We will email you a code to confirm the address."
    : "The questionnaire owner sees this name and email with your answers. They are not checked.";
  return `<dialog id="identity-dialog" class="identity-dialog" aria-labelledby="identity-title" aria-describedby="identity-intro">
  <form id="identity-form" method="dialog" novalidate>
    <h2 id="identity-title">${verifiedMode ? "Verify your email to submit" : "Confirm who is submitting"}</h2>
    <p class="dialog-copy" id="identity-intro">${intro} Cancelling keeps your answers.</p>
    ${identityStep}
    ${codeStep}
    <p class="dialog-error" id="identity-error" role="alert" hidden></p>
  </form>
</dialog>`;
}

export function renderQuestionnaire(questionnaire, nonce) {
  const closed = questionnaire.status !== "open";
  const mode = ["anonymous", "self_report", "email_verified"].includes(questionnaire.authentication_type) ? questionnaire.authentication_type : "anonymous";
  // Custom branding is decorative only. Interactive colors always retain Mocha contrast.
  const accent = /^#[0-9a-f]{6}$/i.test(questionnaire.settings.accent_color || "")
    ? questionnaire.settings.accent_color : "#cba6f7";
  const initialVisibleCount = initialVisibleQuestionCount(questionnaire.questions);
  const hasUploads = hasQuestionType(questionnaire.questions, "file_upload");
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
            ${closed ? "" : `<div class="submit-panel"><div class="submit-kicker">Ready to send?</div><p>${SUBMIT_COPY[mode]}</p>${hasUploads ? `<p class="upload-retention">${UPLOAD_RETENTION_COPY}</p>` : ""}<button class="submit-button" id="submit-response" type="submit">${escapeHtml(questionnaire.settings.submit_label)}<span aria-hidden="true">↗</span></button></div>`}
          </fieldset>
        </form>
        <p class="privacy-note">${PRIVACY_COPY[mode]}</p>
      </div>
    </div>
    <section id="completion-screen" class="completion" tabindex="-1" hidden aria-labelledby="completion-title">
      <div class="completion-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">Response received</p>
      <h2 id="completion-title">Thank you</h2>
      <p>${escapeHtml(questionnaire.settings.completion_message)}</p>
    </section>
  </main>
  ${closed ? "" : renderIdentityDialog(questionnaire, mode)}
  <script type="application/json" id="questionnaire-data">${safeJson(questionnaire)}</script>
  <script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

// Opt-in rich long_text answers are stored as a restricted Quill Delta, never HTML.
// The server normalizes every document; the admin view renders it from an allow-list.
export const RICH_TEXT_FORMAT = "quill_delta_v1";
export const RICH_TEXT_LIMITS = Object.freeze({ max_ops: 2000, max_bytes: 64 * 1024, max_link_length: 2048 });
const LIST_VALUES = new Set(["ordered", "bullet"]);
const ATTRIBUTE_ORDER = ["bold", "italic", "link", "list"];
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Whitespace plus format and zero-width characters that render as nothing.
const INVISIBLE = /[\s­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/gu;

export class RichTextError extends Error {}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function isRichTextDocument(value) {
  return isPlainObject(value);
}

// Absolute http(s) URLs only, without credentials, whitespace, or controls.
export function safeRichTextLink(value) {
  if (typeof value !== "string" || !value || value.length > RICH_TEXT_LIMITS.max_link_length) return null;
  if (/[\s\u0000-\u001F\u007F]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.href.length > RICH_TEXT_LIMITS.max_link_length ? null : parsed.href;
}

function fail(message) {
  throw new RichTextError(message);
}

function cleanAttributes(raw, text) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) fail("rich text attributes must be an object");
  const lineBreaks = /^\n+$/.test(text);
  const attributes = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "bold" || key === "italic") {
      if (value !== true) fail(`${key} must be true when present`);
      attributes[key] = true;
    } else if (key === "link") {
      const link = safeRichTextLink(value);
      if (!link) fail("links must be http or https URLs");
      attributes.link = link;
    } else if (key === "list") {
      if (!LIST_VALUES.has(value)) fail("lists must be ordered or bullet");
      if (!lineBreaks) fail("list formatting applies to line breaks only");
      attributes.list = value;
    } else {
      fail("unsupported rich text formatting");
    }
  }
  // Inline formatting on a bare line break has no visible effect, so it is dropped.
  if (lineBreaks) for (const key of ["bold", "italic", "link"]) delete attributes[key];
  const ordered = {};
  for (const key of ATTRIBUTE_ORDER) if (attributes[key] !== undefined) ordered[key] = attributes[key];
  return Object.keys(ordered).length ? ordered : null;
}

function sameAttributes(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

export function normalizeRichText(value) {
  if (!isPlainObject(value)) fail("answer must be a rich text document");
  if (Object.keys(value).some((key) => key !== "format" && key !== "ops")) fail("rich text may only contain format and ops");
  if (value.format !== RICH_TEXT_FORMAT) fail(`rich text format must be ${RICH_TEXT_FORMAT}`);
  if (!Array.isArray(value.ops) || value.ops.length === 0) fail("rich text ops must be a non-empty array");
  if (value.ops.length > RICH_TEXT_LIMITS.max_ops) fail("rich text has too many operations");
  const ops = [];
  for (const op of value.ops) {
    if (!isPlainObject(op) || typeof op.insert !== "string" || Object.keys(op).some((key) => key !== "insert" && key !== "attributes")) {
      fail("rich text supports text inserts only");
    }
    const text = op.insert.replace(/\r\n?/g, "\n");
    if (CONTROL_CHARACTERS.test(text)) fail("rich text contains control characters");
    const attributes = cleanAttributes(op.attributes, text);
    if (!text) continue;
    const previous = ops.at(-1);
    if (previous && sameAttributes(previous.attributes, attributes)) previous.insert += text;
    else ops.push(attributes ? { insert: text, attributes } : { insert: text });
  }
  // Quill documents always end with a line break; it carries the last line's block format.
  const last = ops.at(-1);
  if (!last || !last.insert.endsWith("\n")) {
    if (last && !last.attributes) last.insert += "\n";
    else ops.push({ insert: "\n" });
  }
  const normalized = { format: RICH_TEXT_FORMAT, ops };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > RICH_TEXT_LIMITS.max_bytes) fail("rich text is too large");
  return normalized;
}

export function richTextPlainText(document) {
  return document.ops.map((op) => op.insert).join("").replace(/\n$/, "");
}

export function hasMeaningfulText(text) {
  return String(text).replace(INVISIBLE, "").length > 0;
}

// True only for a string or well-formed document with nothing visible in it; malformed input is left to normalization errors.
export function richTextIsEmpty(value) {
  if (typeof value === "string") return !hasMeaningfulText(value);
  try {
    return !hasMeaningfulText(richTextPlainText(normalizeRichText(value)));
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderSegment(text, attributes) {
  let html = escapeHtml(text);
  if (attributes?.italic) html = `<em>${html}</em>`;
  if (attributes?.bold) html = `<strong>${html}</strong>`;
  if (attributes?.link) html = `<a href="${escapeHtml(attributes.link)}" target="_blank" rel="noopener noreferrer nofollow">${html}</a>`;
  return html;
}

function renderLines(lines) {
  let html = "";
  let openList = null;
  for (const line of lines) {
    const tag = line.list === "ordered" ? "ol" : line.list === "bullet" ? "ul" : null;
    if (openList && openList !== tag) { html += `</${openList}>`; openList = null; }
    if (tag && !openList) { html += `<${tag}>`; openList = tag; }
    const content = line.html || "<br>";
    html += tag ? `<li>${content}</li>` : `<p>${content}</p>`;
  }
  if (openList) html += `</${openList}>`;
  return `<div class="rich-answer">${html}</div>`;
}

// Deterministic, allow-listed HTML. Input that no longer normalizes renders as inert paragraphs of text.
export function renderRichTextHtml(value) {
  let document;
  try {
    document = normalizeRichText(value);
  } catch {
    const text = Array.isArray(value?.ops) ? value.ops.map((op) => (typeof op?.insert === "string" ? op.insert : "")).join("") : "";
    return renderLines(text.replace(/\n$/, "").split("\n").map((line) => ({ html: escapeHtml(line), list: null })));
  }
  const lines = [];
  let current = "";
  for (const op of document.ops) {
    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (part) current += renderSegment(part, op.attributes);
      if (index < parts.length - 1) {
        lines.push({ html: current, list: op.attributes?.list ?? null });
        current = "";
      }
    });
  }
  if (current) lines.push({ html: current, list: null });
  return renderLines(lines);
}

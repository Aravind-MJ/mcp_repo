import { randomBytes } from "node:crypto";
import { exactDecimal } from "./audit.js";

const PAGE_SIZE = 25;
const TOKEN_FORMAT = new Intl.NumberFormat("en");
const STATUS_BADGES = {
  success: { label: "Succeeded", icon: '<path d="M20 6 9 17l-5-5"/>' },
  failure: { label: "Failed", icon: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>' },
  pending: { label: "In progress", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  stale: { label: "No outcome recorded", icon: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>' },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function logHeaders(response, nonce = "") {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Referrer-Policy", "no-referrer");
  response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  response.set("Cache-Control", "private, no-store");
  response.set("X-Frame-Options", "DENY");
  if (nonce) {
    response.set("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  }
}

function requireTrustedBasicAuth(request, response, next) {
  if (request.get("x-jev-basic-auth") === "1") return next();
  logHeaders(response);
  return response.status(404).type("text").send("Not found");
}

function parseOffset(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function plural(count, noun) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function usd(value) {
  return value === null ? "Cost unavailable" : `$${exactDecimal(value)}`;
}

function utcTime(timestamp) {
  if (!timestamp) return "Not recorded";
  return `<time datetime="${escapeHtml(timestamp)}">${escapeHtml(`${timestamp.slice(0, 19).replace("T", " ")} UTC`)}</time>`;
}

function duration(milliseconds) {
  if (milliseconds === null) return "Not recorded";
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function tokens(call) {
  const parts = [["input_tokens", "in"], ["output_tokens", "out"], ["total_tokens", "total"]]
    .filter(([column]) => call[column] !== null)
    .map(([column, label]) => `${TOKEN_FORMAT.format(call[column])} ${label}`);
  return parts.length ? parts.join(" · ") : "Not reported";
}

function text(value, fallback) {
  return value === null ? fallback : escapeHtml(value);
}

function code(value, fallback) {
  return value === null ? fallback : `<code>${escapeHtml(value)}</code>`;
}

function jsonDetails(label, json, emptyText) {
  const body = json === null ? `<p class="muted">${emptyText}</p>` : `<pre><code>${escapeHtml(JSON.stringify(JSON.parse(json), null, 2))}</code></pre>`;
  return `<details><summary>${label}</summary>${body}</details>`;
}

// A pending call that outlives the OpenRouter timeout has lost its outcome, so it is
// presented for review alongside failures.
function displayState(call, { now, staleAfterMs }) {
  return call.status === "pending" && now - Date.parse(call.started_at) > staleAfterMs ? "stale" : call.status;
}

function renderCall(call, view) {
  const state = displayState(call, view);
  const badge = STATUS_BADGES[state];
  const meta = [
    ["Started", utcTime(call.started_at)],
    ["Completed", utcTime(call.completed_at)],
    ["Duration", duration(call.duration_ms)],
    ["Requested model", text(call.requested_model, "None")],
    ["Served model", text(call.served_model, "Not reported")],
    ["Provider", text(call.provider, "Not reported")],
    ["Tokens", tokens(call)],
    ["Cost", usd(call.cost_usd)],
    ["Call ID", code(call.id)],
    ["JSON-RPC ID", code(call.rpc_id, "Not stored")],
    ["Generation ID", code(call.generation_id, "Not reported")],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  let reason = "";
  if (state === "failure") reason = `<p class="failure-reason"><strong>Failure reason</strong>${escapeHtml(call.error_message)}</p>`;
  if (state === "stale") {
    reason = `<p class="failure-reason"><strong>Needs review</strong>No outcome was recorded within ${Math.round(view.staleAfterMs / 1_000)} seconds of the start. The call may have been interrupted, or its result could not be saved.</p>`;
  }
  return `<article class="call call--${state}" aria-labelledby="call-${escapeHtml(call.id)}"><div class="call-head"><span class="badge badge--${state}"><svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${badge.icon}</svg>${badge.label}</span><h2 id="call-${escapeHtml(call.id)}">${code(call.tool_name, "Unnamed tool")}</h2></div>${reason}<dl class="meta">${meta}</dl>${jsonDetails("Request arguments", call.arguments_json, "No arguments were sent.")}${call.status === "success" ? jsonDetails("Result", call.result_json, "No result was stored.") : ""}</article>`;
}

function renderSummary(summary) {
  const cost = summary.total_cost_usd === null ? "Cost unavailable" : `$${summary.total_cost_usd}`;
  const uncosted = summary.total - summary.costed;
  const note = summary.costed && uncosted
    ? `<p class="summary-note muted">${uncosted === 1 ? "1 call has" : `${uncosted} calls have`} no cost data, so the total covers ${plural(summary.costed, "call")}.</p>`
    : "";
  const failed = `<div${summary.failed ? ' class="summary-failed"' : ""}><dt>Failed</dt><dd>${summary.failed}</dd></div>`;
  const unfinished = summary.pending ? `<div class="summary-unfinished"><dt>Unfinished</dt><dd>${summary.pending}</dd></div>` : "";
  return `<dl class="summary" aria-label="Totals for every recorded call"><div><dt>Total calls</dt><dd>${summary.total}</dd></div><div><dt>Succeeded</dt><dd>${summary.succeeded}</dd></div>${failed}${unfinished}<div><dt>Total cost</dt><dd>${cost}</dd></div></dl>${note}`;
}

function renderPagination(page) {
  if (!page.calls.length) return "";
  const previous = page.offset > 0 ? `<a class="button" rel="prev" href="/jev/logs?offset=${Math.max(0, page.offset - page.limit)}">Newer calls</a>` : "";
  const next = page.has_more ? `<a class="button" rel="next" href="/jev/logs?offset=${page.offset + page.limit}">Older calls</a>` : "";
  return `<nav class="pagination" aria-label="Log pages">${previous}<span class="muted">Calls ${page.offset + 1} to ${page.offset + page.calls.length} of ${page.total}</span>${next}</nav>`;
}

function renderEmpty(page) {
  if (page.total > 0) {
    return `<section class="empty"><h2>No calls on this page</h2><p>This page is past the oldest recorded call.</p><a class="button" href="/jev/logs">Show the newest calls</a></section>`;
  }
  return `<section class="empty"><h2>No Jev tool calls recorded yet</h2><p>Authenticated tools/call requests to the Jev MCP endpoint appear here, newest first, including calls that fail.</p></section>`;
}

function renderPage({ summary, page, view }, nonce) {
  const content = page.calls.map((call) => renderCall(call, view)).join("") || renderEmpty(page);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/jev.svg" type="image/svg+xml"><title>Jev calls</title>
<style nonce="${escapeHtml(nonce)}">
:root{color-scheme:dark;--bg:#090b10;--panel:#11141b;--raised:#181c25;--line:#292e3a;--text:#f5f6f8;--muted:#9aa2b1;--accent:#e7a8ff;--success:#7ee2ae;--success-soft:#12261e;--warning:#ffd083;--warning-soft:#292219;--danger:#ff858d;--danger-soft:#2b171b}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:radial-gradient(circle at 12% -10%,#2a1f3a 0,transparent 35rem),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}header,main,.toolbar{width:min(1200px,calc(100% - 32px));margin-inline:auto}header{display:flex;justify-content:space-between;align-items:end;gap:24px;padding:58px 0 28px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:17px}.brand img{width:60px;height:60px;border-radius:16px;box-shadow:0 14px 44px #0008}.eyebrow{margin:0 0 7px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}h1{margin:0;font-size:clamp(36px,6vw,68px);line-height:.95;letter-spacing:-.055em}h2,p{margin-top:0}.count{color:var(--muted);white-space:nowrap}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;padding:22px 0 0}.toolbar a,.button{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:11px;background:var(--raised);font-weight:700;text-decoration:none}.toolbar a:hover,.button:hover{border-color:#596176}.muted{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:22px 0 0}.summary>div{padding:14px;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.summary dt{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.summary dd{margin:4px 0 0;font-size:22px;font-weight:750;overflow-wrap:anywhere}.summary-failed{border-color:#683039!important;background:var(--danger-soft)!important}.summary-failed dd{color:var(--danger)}.summary-note{margin:10px 0 0;font-size:13px}main{padding:24px 0 64px}.calls{display:grid;gap:14px;margin-top:24px}.call{min-width:0;padding:18px 20px;border:1px solid var(--line);border-left:5px solid var(--line);border-radius:14px;background:var(--panel)}.call--success{border-left-color:var(--success)}.call-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}.call-head h2{margin:0;font-size:17px;overflow-wrap:anywhere}.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid transparent;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.badge--success{border-color:#2c5a45;background:var(--success-soft);color:var(--success)}.call--failure{border-color:var(--danger);border-left-width:8px;background:linear-gradient(90deg,var(--danger-soft),var(--panel) 45%)}.badge--failure{border-color:var(--danger);background:var(--danger-soft);color:var(--danger)}.failure-reason{margin:14px 0 0;padding:10px 14px;border-left:3px solid var(--danger);border-radius:0 10px 10px 0;background:#1f1115;color:#ffd6d9;white-space:pre-wrap;overflow-wrap:anywhere}.failure-reason strong{display:block;margin-bottom:2px;color:var(--danger);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.call--pending{border-left-color:var(--warning)}.badge--pending{border-color:#6b5530;background:var(--warning-soft);color:var(--warning)}.call--stale{border-color:var(--danger);border-left-width:8px;background:linear-gradient(90deg,var(--danger-soft),var(--panel) 45%)}.badge--stale{border-color:var(--danger);background:var(--danger-soft);color:var(--danger)}.summary-unfinished{border-color:#6b5530!important;background:var(--warning-soft)!important}.summary-unfinished dd{color:var(--warning)}.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 18px;margin:16px 0 0}.meta dt{color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.meta dd{margin:2px 0 0;overflow-wrap:anywhere}.meta code,pre{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}details{margin-top:14px;padding-top:10px;border-top:1px solid var(--line)}summary{width:max-content;max-width:100%;color:#d8dce4;font-weight:700;cursor:pointer}pre{max-height:28rem;overflow:auto;margin:10px 0 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:#0c0f15;white-space:pre-wrap;overflow-wrap:anywhere}.empty{padding:70px 24px;border:1px dashed #3a4050;border-radius:18px;text-align:center;color:var(--muted)}.empty h2{color:var(--text)}.empty .button{color:var(--text)}.pagination{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;padding:26px 0 0}:focus-visible{outline:3px solid #f0d4ff;outline-offset:3px}@media(max-width:640px){header{align-items:start;flex-direction:column;padding-top:34px}.count{white-space:normal}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head><body>
<header><div class="brand"><img src="/jev.svg" alt="" width="60" height="60"><div><p class="eyebrow">Private audit log</p><h1>Jev calls</h1></div></div><div class="count">${plural(summary.total, "call")}</div></header>
<nav class="toolbar" aria-label="Jev call log"><a href="/jev">← Jev overview</a><span class="muted">Newest first. Times are UTC.</span></nav>
<main>${renderSummary(summary)}<div class="calls">${content}</div>${renderPagination(page)}</main></body></html>`;
}

export function mountJevLogRoutes(app, auditLog, { staleAfterMs }) {
  app.use("/jev/logs", requireTrustedBasicAuth);

  app.get(["/jev/logs", "/jev/logs/"], (request, response, next) => {
    try {
      const nonce = randomBytes(18).toString("base64");
      logHeaders(response, nonce);
      const page = auditLog.list({ limit: PAGE_SIZE, offset: parseOffset(request.query.offset) });
      const view = { now: Date.now(), staleAfterMs };
      response.type("html").send(renderPage({ summary: auditLog.summary(), page, view }, nonce));
    } catch (error) { next(error); }
  });
}

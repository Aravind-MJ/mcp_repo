import express from "express";
import { readFile } from "node:fs/promises";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mountAttachmentRoutes } from "./artifact/attachments.js";
import { ArtifactStore } from "./artifact/store.js";
import { createArtifactMcpServer } from "./artifact/mcp.js";
import { QuestionnaireStore } from "./questionnaire/store.js";
import { createQuestionnaireMcpServer } from "./questionnaire/mcp.js";
import { mountQuestionnaireRoutes } from "./questionnaire/routes.js";
import { mountQuestionnaireAdminRoutes } from "./questionnaire/admin.js";
import { JevClient, openRouterApiKeyAvailable } from "./jev/client.js";
import { createJevMcpServer } from "./jev/mcp.js";
import { LANDING_HTML } from "./landing.js";
import { ARTIFACT_LANDING_HTML, JEV_LANDING_HTML } from "./module-landings.js";
import { ServiceError } from "./errors.js";
import { artifactSignedUrlIsValid, createGalleryFlash, galleryCsrfIsValid, galleryCsrfToken, readGalleryFlash, readSharedSecret, sharedSecretAuth } from "./security.js";

const PUBLIC_INSTALL_README = await readFile(new URL("../public/README.md", import.meta.url), "utf8");
const PUBLIC_SKILL = await readFile(new URL("../public/SKILL.md", import.meta.url), "utf8");
const PUBLIC_LOGO = await readFile(new URL("../public/logo.svg", import.meta.url), "utf8");
const PUBLIC_FAVICON = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const PUBLIC_HUB_MARK = await readFile(new URL("../public/hub.svg", import.meta.url), "utf8");
const PUBLIC_QUESTIONNAIRE_MARK = await readFile(new URL("../public/questionnaire.svg", import.meta.url), "utf8");
const PUBLIC_JEV_MARK = await readFile(new URL("../public/jev.svg", import.meta.url), "utf8");
const PUBLIC_JEV_INSTALL_README = await readFile(new URL("../public/jev-README.md", import.meta.url), "utf8");
const PUBLIC_JEV_SKILL = await readFile(new URL("../public/jev-SKILL.md", import.meta.url), "utf8");
const GALLERY_FLASH_COOKIE = "artifact_gallery_flash";

function cookieValue(request, name) {
  const prefix = `${name}=`;
  for (const part of (request.get("cookie") || "").split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return "";
}

function galleryFlashCookie(value, maxAge) {
  return `${GALLERY_FLASH_COOKIE}=${encodeURIComponent(value)}; Path=/artifacts; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}


function securityHeaders(response) {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Referrer-Policy", "no-referrer");
  response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

async function artifactAccessAllowed(request, artifactId, version, secretFile) {
  if (request.get("x-artifact-basic-auth") === "1") return true;
  return artifactSignedUrlIsValid({
    artifactId,
    ...(version === undefined ? {} : { version }),
    expires: request.query.expires,
    signature: request.query.signature,
    secretFile,
  });
}

function artifactResponseHeaders(response) {
  securityHeaders(response);
  response.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
}

function jsonRpcMethodNotAllowed(response) {
  response.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderArtifactGallery(artifacts, deletedArtifactId = "", tags = [], selectedTag) {
  const cards = artifacts.map((artifact) => {
    const id = escapeHtml(artifact.artifact_id);
    const title = escapeHtml(artifact.title || "Untitled artifact");
    const shareUrl = escapeHtml(artifact.share.url);
    const createdAt = new Date(artifact.created_at);
    const displayDate = Number.isNaN(createdAt.getTime())
      ? "Unknown date"
      : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(createdAt) + " UTC";
    return `<article class="card">
      <button type="button" class="share-button" data-sign-artifact="${id}" data-csrf-token="${escapeHtml(artifact.csrf_token)}" aria-label="Copy a new one-week link for ${title}" title="Copy 1-week link">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>
      </button>
      <button type="button" class="delete-button" data-delete-dialog="delete-${id}" aria-label="Delete ${title}" title="Delete artifact">
        <svg class="trash-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>
      </button>
      <a class="preview" href="${shareUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open ${title} in a new tab">
        <iframe src="${shareUrl}" title="Preview of ${title}" loading="lazy" sandbox="" tabindex="-1"></iframe>
      </a>
      <div class="details">
        <h2><a href="${shareUrl}" target="_blank" rel="noopener noreferrer">${title}</a></h2>
        <p>${escapeHtml(displayDate)} <span aria-hidden="true">·</span> ${escapeHtml(formatBytes(artifact.bytes))} <span aria-hidden="true">·</span> Version ${escapeHtml(artifact.version)}</p>
        <code>${id}</code>
        <details class="version-control">
          <summary>Version history (${artifact.versions.length})</summary>
          <ol>${artifact.versions.map((version) => `<li><a href="${escapeHtml(version.share.url)}" target="_blank" rel="noopener noreferrer">Version ${version.version}</a></li>`).join("")}</ol>
        </details>
      </div>
      <dialog id="delete-${id}" class="delete-dialog" aria-labelledby="delete-title-${id}">
        <form method="dialog" class="dialog-shell">
          <div class="dialog-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </div>
          <div><p class="dialog-eyebrow">Permanent action</p><h3 id="delete-title-${id}">Permanently delete this artifact?</h3></div>
          <p><strong>${title}</strong> and every stored version will be removed. The public URL will stop working. This cannot be undone.</p>
          <div class="dialog-actions">
            <button type="button" class="cancel-delete">Cancel</button>
            <button type="submit" class="confirm-delete" form="delete-form-${id}">Delete artifact</button>
          </div>
        </form>
        <form id="delete-form-${id}" method="post" action="/artifacts/${id}/delete">
          <input type="hidden" name="csrf_token" value="${escapeHtml(artifact.csrf_token)}">
        </form>
      </dialog>
    </article>`;
  }).join("\n");

  const filters = tags.length || selectedTag
    ? `<nav class="tag-filters" aria-label="Filter by tag"><a href="/artifacts">Clear filter</a>${tags.map(tag => `<a href="/artifacts?tag=${encodeURIComponent(tag)}" aria-current="${tag === selectedTag ? "true" : "false"}">${escapeHtml(tag)}</a>`).join("")}</nav>`
    : "";
  const content = cards || `<section class="empty"><h2>${selectedTag ? "No artifacts match this tag" : "No artifacts yet"}</h2><p>${selectedTag ? "Choose another tag or clear the filter." : "Published HTML will appear here."}</p></section>`;
  const notice = deletedArtifactId
    ? `<div class="notice" role="status">Deleted artifact <code>${escapeHtml(deletedArtifactId)}</code>.</div>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>Artifact Gallery</title>
<style>
:root{color-scheme:dark;--bg:#090b10;--panel:#11141b;--line:#272b36;--text:#f4f5f7;--muted:#949baa;--accent:#a8b4ff;--danger:#ff7777}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}header,main,.notice{width:min(1180px,calc(100% - 32px));margin-inline:auto}header{display:flex;justify-content:space-between;align-items:end;gap:24px;padding:64px 0 32px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:18px}.brand>img{border-radius:16px;box-shadow:0 12px 38px #0008}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}h1{margin:0;font-size:clamp(36px,7vw,72px);line-height:.95;letter-spacing:-.055em}header .count{color:var(--muted);white-space:nowrap}.notice{margin-top:24px;padding:12px 14px;border:1px solid #355a48;border-radius:10px;background:#13251d;color:#baf7d3}.notice code{color:inherit}.copy-status{position:fixed;z-index:20;left:50%;bottom:22px;max-width:min(520px,calc(100% - 32px));padding:11px 15px;border:1px solid #355a48;border-radius:10px;background:#13251df2;color:#baf7d3;box-shadow:0 14px 42px #000a;opacity:0;pointer-events:none;transform:translate(-50%,8px);transition:opacity .18s ease,transform .18s ease}.copy-status.visible{opacity:1;transform:translate(-50%,0)}.copy-status.error{border-color:#733842;background:#29171af2;color:#ffd0d4}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:20px;padding:28px 0 64px}.card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--panel);transition:transform .18s ease,border-color .18s ease}.card:hover{transform:translateY(-3px);border-color:#454b5c}.share-button,.delete-button{position:absolute;z-index:4;top:12px;display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid #ffffff24;border-radius:11px;background:#11141be8;color:#d5d9e2;box-shadow:0 8px 24px #0008;cursor:pointer;opacity:0;transform:translateY(-5px);transition:opacity .16s ease,transform .16s ease,background .16s ease,color .16s ease}.delete-button{right:12px}.share-button{right:58px}.card:hover .share-button,.card:focus-within .share-button,.share-button:focus-visible,.card:hover .delete-button,.card:focus-within .delete-button,.delete-button:focus-visible{opacity:1;transform:translateY(0)}.share-button:hover,.share-button:focus-visible{background:#27315e;color:#fff;outline:2px solid #9eabff;outline-offset:2px}.delete-button:hover,.delete-button:focus-visible{background:#6f2630;color:#fff;outline:2px solid #ff8a93;outline-offset:2px}.trash-icon{pointer-events:none}.preview{position:relative;display:block;aspect-ratio:16/10;overflow:hidden;background:#fff}.preview:after{content:"";position:absolute;inset:0}.preview iframe{width:160%;height:160%;border:0;transform:scale(.625);transform-origin:top left;pointer-events:none}.details{padding:18px}.details h2{margin:0 0 8px;font-size:18px;line-height:1.25;letter-spacing:-.02em}.details a{color:inherit;text-decoration:none}.details>p{margin:0 0 13px;color:var(--muted);font-size:13px}.details>code{display:block;overflow:hidden;color:#6f7685;font-size:11px;text-overflow:ellipsis}.version-control{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.version-control summary{width:max-content;color:#a8adb8;font-size:13px;cursor:pointer}.version-control ol{margin:10px 0 0;padding-left:20px}.version-control li{margin:5px 0;color:var(--muted);font-size:12px}.version-control li a{color:var(--accent)}.delete-dialog{width:min(440px,calc(100% - 28px));padding:0;border:1px solid #3a3f4c;border-radius:18px;background:#12151c;color:var(--text);box-shadow:0 28px 100px #000d}.delete-dialog::backdrop{background:#05060aab;backdrop-filter:blur(6px)}.dialog-shell{display:grid;grid-template-columns:auto 1fr;gap:14px;padding:24px}.dialog-icon{display:grid;place-items:center;width:44px;height:44px;border:1px solid #743843;border-radius:12px;background:#2a171b;color:#ff8a93}.dialog-eyebrow{margin:0 0 3px;color:#ff8a93;font-size:11px;font-weight:750;letter-spacing:.13em;text-transform:uppercase}.dialog-shell h3{margin:0;font-size:19px;letter-spacing:-.02em}.dialog-shell>p{grid-column:1/-1;margin:4px 0;color:#b8bec9}.dialog-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px;margin-top:5px}.dialog-actions button{border-radius:9px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}.cancel-delete{border:1px solid var(--line);background:#1a1e27;color:#d8dce4}.confirm-delete{border:1px solid #9a4652;background:#7c2934;color:#fff}.cancel-delete:hover{background:#232833}.confirm-delete:hover{background:#963440}.empty{grid-column:1/-1;padding:80px 24px;text-align:center;border:1px dashed var(--line);border-radius:18px}.empty h2{margin:0 0 8px}.empty p{margin:0;color:var(--muted)}@media(max-width:560px){header{align-items:start;flex-direction:column;padding-top:40px}}@media(hover:none){.share-button,.delete-button{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}.share-button,.delete-button{transition:none}}
.tag-filters{display:flex;flex-wrap:wrap;gap:8px;width:min(1180px,calc(100% - 32px));margin:20px auto 0}.tag-filters a{border:1px solid var(--line);border-radius:999px;padding:6px 12px;color:var(--text);text-decoration:none}.tag-filters a[aria-current="true"]{background:var(--accent);color:var(--bg)}.tag-filters a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
</style></head><body>
<header><div class="brand"><img src="/logo.svg" alt="" width="62" height="62"><div><p class="eyebrow">Private index</p><h1>Artifacts</h1></div></div><div class="count">${artifacts.length} ${artifacts.length === 1 ? "artifact" : "artifacts"}</div></header>
${filters}${notice}<div id="copy-status" class="copy-status" role="status" aria-live="polite"></div><main>${content}</main>
<script>
const copyStatus = document.getElementById("copy-status");
for (const button of document.querySelectorAll("[data-sign-artifact]")) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/artifacts/" + button.dataset.signArtifact + "/sign", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf_token: button.dataset.csrfToken }),
      });
      if (!response.ok) throw new Error("Could not create a signed URL");
      const payload = await response.json();
      await navigator.clipboard.writeText(payload.url);
      copyStatus.textContent = "Copied a signed link valid until " + new Date(payload.expires_at).toLocaleString() + ".";
      copyStatus.classList.add("visible");
      setTimeout(() => copyStatus.classList.remove("visible"), 5000);
    } catch (error) {
      copyStatus.textContent = error.message;
      copyStatus.classList.add("visible", "error");
    } finally {
      button.disabled = false;
    }
  });
}
for (const trigger of document.querySelectorAll("[data-delete-dialog]")) {
  trigger.addEventListener("click", () => {
    const deleteDialog = document.getElementById(trigger.dataset.deleteDialog);
    if (deleteDialog?.showModal) deleteDialog.showModal();
  });
}
for (const button of document.querySelectorAll(".cancel-delete")) {
  button.addEventListener("click", () => button.closest("dialog")?.close());
}
for (const dialog of document.querySelectorAll(".delete-dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
</script></body></html>`;
}

export async function createApp(config) {
  const store = new ArtifactStore(config);
  const questionnaireStore = new QuestionnaireStore(config);
  const jevClient = new JevClient({
    apiKeyFile: config.openRouterApiKeyFile,
    timeoutMs: config.jevTimeoutMs,
  });
  await store.initialize();
  await questionnaireStore.initialize();
  await readSharedSecret(config.secretFile);

  const app = express();
  app.use(hostHeaderValidation(config.allowedHosts));
  app.disable("x-powered-by");

  app.get("/healthz", async (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "no-store");
    const modules = ["artifact", "questionnaire"];
    if (await openRouterApiKeyAvailable(config.openRouterApiKeyFile)) modules.push("jev");
    response.json({ status: "ok", modules });
  });

  app.get("/logo.svg", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=86400");
    response.type("image/svg+xml").send(PUBLIC_LOGO);
  });

  app.get("/favicon.svg", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=86400");
    response.type("image/svg+xml").send(PUBLIC_FAVICON);
  });

  app.get("/hub.svg", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=86400");
    response.type("image/svg+xml").send(PUBLIC_HUB_MARK);
  });

  app.get("/questionnaire.svg", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=86400");
    response.type("image/svg+xml").send(PUBLIC_QUESTIONNAIRE_MARK);
  });

  app.get("/jev.svg", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=86400");
    response.type("image/svg+xml").send(PUBLIC_JEV_MARK);
  });

  mountAttachmentRoutes(app, store.attachments);
  mountQuestionnaireRoutes(app, questionnaireStore, questionnaireStore.config);
  mountQuestionnaireAdminRoutes(app, questionnaireStore, questionnaireStore.config);

  app.get("/", (request, response) => {
    securityHeaders(response);
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.set("Cache-Control", "public, max-age=300");
    response.type("html").send(LANDING_HTML);
  });

  app.get(["/artifact", "/artifact/"], (request, response) => {
    securityHeaders(response);
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.set("Cache-Control", "public, max-age=300");
    response.type("html").send(ARTIFACT_LANDING_HTML);
  });

  app.get(["/jev", "/jev/"], (request, response) => {
    securityHeaders(response);
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.set("Cache-Control", "public, max-age=300");
    response.type("html").send(JEV_LANDING_HTML);
  });

  app.get(["/artifacts", "/artifacts/"], async (request, response, next) => {
    try {
      const selectedTag = request.query.tag === undefined ? undefined : store.normalizeTags([request.query.tag])[0];
      const { artifacts: listedArtifacts, tags } = await store.listWithTags(config.maxListItems, selectedTag);
      const artifacts = await Promise.all(listedArtifacts.map(async (artifact) => {
        const versions = await store.listVersions(artifact.artifact_id);
        return {
          ...artifact,
          csrf_token: await galleryCsrfToken(artifact.artifact_id, config.secretFile),
          share: await store.createSignedUrl(artifact.artifact_id),
          versions: await Promise.all(versions.map(async (version) => ({
            ...version,
            share: await store.createSignedUrl(artifact.artifact_id, undefined, version.version),
          }))),
        };
      }));
      const flashValue = cookieValue(request, GALLERY_FLASH_COOKIE);
      const deletedArtifactId = await readGalleryFlash(flashValue, config.secretFile);
      securityHeaders(response);
      if (flashValue) response.append("Set-Cookie", galleryFlashCookie("", 0));
      response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      response.set("Cache-Control", "private, no-store");
      response.type("html").send(renderArtifactGallery(artifacts, deletedArtifactId, tags, selectedTag));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/artifacts/:artifactId/sign",
    express.urlencoded({ extended: false, limit: "4kb", parameterLimit: 4 }),
    async (request, response, next) => {
      try {
        const artifactId = store.validateId(request.params.artifactId);
        if (!(await galleryCsrfIsValid(artifactId, request.body?.csrf_token, config.secretFile))) {
          throw new ServiceError(403, "Invalid gallery confirmation token");
        }
        const signed = await store.createSignedUrl(artifactId);
        securityHeaders(response);
        response.set("Cache-Control", "no-store");
        response.json(signed);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/artifacts/:artifactId/delete",
    express.urlencoded({ extended: false, limit: "4kb", parameterLimit: 4 }),
    async (request, response, next) => {
      try {
        const artifactId = store.validateId(request.params.artifactId);
        if (!(await galleryCsrfIsValid(artifactId, request.body?.csrf_token, config.secretFile))) {
          throw new ServiceError(403, "Invalid gallery confirmation token");
        }
        await store.delete(artifactId);
        response.set("Cache-Control", "no-store");
        response.append("Set-Cookie", galleryFlashCookie(await createGalleryFlash(artifactId, config.secretFile), 120));
        response.redirect(303, "/artifacts");
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(["/artifact/README.md", "/artifact/install.md"], (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=300");
    response.type("text/markdown; charset=utf-8").send(PUBLIC_INSTALL_README);
  });

  app.get("/artifact/SKILL.md", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=300");
    response.type("text/markdown; charset=utf-8").send(PUBLIC_SKILL);
  });

  app.get(["/jev/README.md", "/jev/install.md"], (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=300");
    response.type("text/markdown; charset=utf-8").send(PUBLIC_JEV_INSTALL_README);
  });

  app.get("/jev/SKILL.md", (request, response) => {
    securityHeaders(response);
    response.set("Cache-Control", "public, max-age=300");
    response.type("text/markdown; charset=utf-8").send(PUBLIC_JEV_SKILL);
  });

  app.get("/artifact/:artifactId/versions/:version", async (request, response, next) => {
    try {
      const artifactId = store.validateId(request.params.artifactId);
      const version = store.validateVersion(request.params.version);
      if (!(await artifactAccessAllowed(request, artifactId, version, config.secretFile))) {
        if (request.query.expires || request.query.signature) return response.redirect(302, request.path);
        throw new ServiceError(404, "Artifact version not found");
      }
      const { html, metadata } = await store.read(artifactId, version);
      const etag = `"sha256-${metadata.sha256}"`;
      artifactResponseHeaders(response);
      response.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; base-uri 'none'; object-src 'none'");
      response.set("Content-Disposition", "inline");
      response.set("Cache-Control", "public, max-age=31536000, immutable");
      response.set("ETag", etag);
      response.type("html");
      const rendered = await store.attachments.render(artifactId, html, request.get("x-artifact-basic-auth") === "1" ? String(Math.floor(Date.now() / 1000) + 3600) : request.query.expires);
      if (rendered !== html) {
        response.set("Cache-Control", "private, no-store");
        response.removeHeader("ETag");
        response.set("Content-Length", String(rendered.length));
        return response.end(rendered);
      }
      if (request.get("if-none-match") === etag) return response.status(304).end();
      return response.send(html);
    } catch (error) {
      return next(error);
    }
  });

  app.use("/artifact/mcp", sharedSecretAuth(config.secretFile));
  app.post("/artifact/mcp", express.json({ limit: config.maxHtmlBytes + 64 * 1024, strict: true }), async (request, response, next) => {
    const server = createArtifactMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      next(error);
    }
  });
  app.all("/artifact/mcp", (request, response) => jsonRpcMethodNotAllowed(response));

  app.use("/questionnaire/mcp", sharedSecretAuth(config.secretFile));
  app.post("/questionnaire/mcp", express.json({ limit: "1mb", strict: true }), async (request, response, next) => {
    const server = createQuestionnaireMcpServer(questionnaireStore);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      next(error);
    }
  });
  app.all("/questionnaire/mcp", (request, response) => jsonRpcMethodNotAllowed(response));

  app.use("/jev/mcp", sharedSecretAuth(config.secretFile));
  app.post("/jev/mcp", express.json({ limit: "2mb", strict: true }), async (request, response, next) => {
    const server = createJevMcpServer(jevClient);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      next(error);
    }
  });
  app.all("/jev/mcp", (request, response) => jsonRpcMethodNotAllowed(response));

  app.get("/artifact/:artifactId", async (request, response, next) => {
    try {
      const artifactId = store.validateId(request.params.artifactId);
      if (!(await artifactAccessAllowed(request, artifactId, undefined, config.secretFile))) {
        if (request.query.expires || request.query.signature) return response.redirect(302, request.path);
        throw new ServiceError(404, "Artifact not found");
      }
      const { html, metadata } = await store.read(artifactId);
      const etag = `"sha256-${metadata.sha256}"`;
      artifactResponseHeaders(response);
      response.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; base-uri 'none'; object-src 'none'");
      response.set("Content-Disposition", "inline");
      response.set("Cache-Control", "public, max-age=60, must-revalidate");
      response.set("ETag", etag);
      response.type("html");
      const rendered = await store.attachments.render(artifactId, html, request.get("x-artifact-basic-auth") === "1" ? String(Math.floor(Date.now() / 1000) + 3600) : request.query.expires);
      if (rendered !== html) {
        response.set("Cache-Control", "private, no-store");
        response.removeHeader("ETag");
        response.set("Content-Length", String(rendered.length));
        return response.end(rendered);
      }
      if (request.get("if-none-match") === etag) return response.status(304).end();
      return response.send(html);
    } catch (error) {
      return next(error);
    }
  });

  app.use((request, response) => {
    securityHeaders(response);
    response.status(404).type("text").send("Not found");
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    securityHeaders(response);
    response.set("Cache-Control", "no-store");
    if (error?.type === "entity.too.large") {
      return response.status(413).json({ error: "Request body exceeds the storage limit" });
    }
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }
    const status = error instanceof ServiceError ? error.status : 500;
    const message = error instanceof ServiceError ? error.message : "Internal server error";
    if (status >= 500) console.error(error);
    return response.status(status).json({ error: message });
  });

  return { app, store, questionnaireStore };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import contentDisposition from "content-disposition";
import { ServiceError } from "../errors.js";
import { readSharedSecret, sharedSecretAuth } from "../security.js";
import { generateArtifactId } from "./store.js";

const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/ogg",
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
]);

export class ArtifactAttachments {
  constructor(store) {
    this.store = store;
    this.config = store.config;
    this.directory = path.join(this.config.dataDir, "artifact", "attachments");
    this.maxBytes = this.config.maxAttachmentBytes ?? 256 * 1024 * 1024;
  }

  artifactDir(id) { return path.join(this.directory, this.store.validateId(id)); }
  filePath(id, attachmentId) { return path.join(this.artifactDir(id), this.store.validateId(attachmentId)); }

  async list(id) {
    await this.store.readLatestMetadata(id);
    let entries;
    try { entries = await readdir(this.artifactDir(id)); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return Promise.all(entries.filter(name => /^[A-Za-z0-9]{24}\.json$/.test(name)).sort().map(name => readFile(path.join(this.artifactDir(id), name), "utf8").then(JSON.parse)));
  }

  async uploadInfo(id) {
    const attachments = await this.list(id);
    const expires = Math.floor(Date.now() / 1000) + 600;
    const signature = await this.signature(id, "upload", expires);
    return { artifact_id: id, upload_url: `${this.config.publicBaseUrl}/artifact/${this.store.validateId(id)}/attachments?expires=${expires}&signature=${signature}`, method: "POST", authentication: "Upload capability URL; no Authorization header required", expires, expires_at: new Date(expires * 1000).toISOString(), expires_in_seconds: 600, max_bytes: this.maxBytes, attachments };
  }

  async upload(id, request) {
    return this.store.withUpdateLock(id, async () => {
      await this.store.readLatestMetadata(id);
      const filename = request.query.filename;
      if (typeof filename !== "string" || !filename.trim() || Buffer.byteLength(filename) > 180 || /[\/\\\x00-\x1f\x7f]/.test(filename) || filename === "." || filename === "..") throw new ServiceError(400, "filename must be a safe basename of at most 180 UTF-8 bytes");
      if (Number(request.get("content-length")) > this.maxBytes) throw new ServiceError(413, "Attachment exceeds byte limit");
      if ((await this.list(id)).length >= (this.config.maxAttachmentsPerArtifact ?? 100)) throw new ServiceError(409, "Artifact attachment count limit reached");
      const suppliedType = (request.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
      const contentType = INLINE_TYPES.has(suppliedType) ? suppliedType : "application/octet-stream";
      const attachmentId = generateArtifactId();
      const destination = this.filePath(id, attachmentId);
      await mkdir(this.artifactDir(id), { recursive: true, mode: 0o700 });
      const temporary = `${destination}.upload`;
      let handle;
      let bytes = 0;
      try {
        handle = await open(temporary, "wx", 0o600);
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          bytes += chunk.length;
          if (bytes > this.maxBytes) throw new ServiceError(413, "Attachment exceeds byte limit");
          await handle.writeFile(chunk);
        }
        if (bytes === 0) throw new ServiceError(400, "Attachment must not be empty");
        await handle.sync();
        await handle.close();
        handle = undefined;
        const metadata = { attachment_id: attachmentId, reference: `artifact-attachment:${attachmentId}`, filename, content_type: contentType, bytes };
        await rename(temporary, destination);
        await this.store.atomicWrite(`${destination}.json`, JSON.stringify(metadata));
        return metadata;
      } catch (error) {
        request.resume();
        await rm(destination, { force: true });
        await rm(`${destination}.json`, { force: true });
        if (request.aborted) throw new ServiceError(400, "Upload interrupted");
        throw error;
      } finally {
        await handle?.close().catch(() => {});
        await rm(temporary, { force: true });
      }
    });
  }

  async read(id, attachmentId) {
    await this.store.readLatestMetadata(id);
    try { return JSON.parse(await readFile(`${this.filePath(id, attachmentId)}.json`, "utf8")); }
    catch { throw new ServiceError(404, "Attachment not found"); }
  }

  async signature(id, attachmentId, expires) {
    return createHmac("sha256", await readSharedSecret(this.config.secretFile)).update(`artifact-attachment:${id}:${attachmentId}:${expires}`).digest("hex");
  }

  async authorized(id, attachmentId, query) {
    if (typeof query.expires !== "string" || !/^\d{10}$/.test(query.expires) || Number(query.expires) < Math.floor(Date.now() / 1000)) return false;
    if (typeof query.signature !== "string" || !/^[a-f0-9]{64}$/.test(query.signature)) return false;
    const expected = await this.signature(id, attachmentId, query.expires);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(query.signature));
  }

  references(html) {
    return [...new Set(html.toString("utf8").match(/artifact-attachment:[A-Za-z0-9_-]*/g) || [])];
  }

  async validateReferences(id, html) {
    for (const reference of this.references(html)) await this.read(id, reference.split(":")[1]);
  }

  async render(id, html, expires) {
    const text = html.toString("utf8");
    const references = this.references(html);
    let rendered = text;
    for (const reference of references) {
      const attachmentId = reference.split(":")[1];
      await this.read(id, attachmentId);
      const signature = await this.signature(id, attachmentId, expires);
      rendered = rendered.replaceAll(reference, `${this.config.publicBaseUrl}/artifact/${id}/attachments/${attachmentId}?expires=${expires}&signature=${signature}`);
    }
    return references.length ? Buffer.from(rendered) : html;
  }
}

export function mountAttachmentRoutes(app, attachments) {
  app.post("/artifact/:artifactId/attachments", async (request, response, next) => {
    try {
      attachments.store.validateId(request.params.artifactId);
      if (await attachments.authorized(request.params.artifactId, "upload", request.query)) return next();
      return sharedSecretAuth(attachments.config.secretFile)(request, response, next);
    } catch (error) { next(error); }
  }, async (request, response, next) => {
    try {
      const result = await attachments.upload(request.params.artifactId, request);
      response.set("Cache-Control", "no-store").status(201).json(result);
    } catch (error) { next(error); }
  });
  app.get("/artifact/:artifactId/attachments/:attachmentId", async (request, response, next) => {
    try {
      const { artifactId, attachmentId } = request.params;
      attachments.store.validateId(artifactId);
      attachments.store.validateId(attachmentId);
      if (!(await attachments.authorized(artifactId, attachmentId, request.query))) throw new ServiceError(404, "Attachment not found");
      const metadata = await attachments.read(artifactId, attachmentId);
      response.set("Content-Type", metadata.content_type);
      response.set("Content-Disposition", contentDisposition(metadata.filename, { type: INLINE_TYPES.has(metadata.content_type) ? "inline" : "attachment" }));
      response.set("X-Content-Type-Options", "nosniff");
      response.set("Content-Security-Policy", "sandbox; default-src 'none'");
      response.set("Referrer-Policy", "no-referrer");
      response.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      response.set("Cache-Control", "private, no-store");
      response.sendFile(attachments.filePath(artifactId, attachmentId), { cacheControl: false, dotfiles: "allow" }, error => {
        if (!error) return;
        if (error.status === 416) { response.set("Content-Range", `bytes */${metadata.bytes}`); return next(new ServiceError(416, "Range not satisfiable")); }
        if (error.status === 404) return next(new ServiceError(404, "Attachment not found"));
        next(error);
      });
    } catch (error) { next(error); }
  });
}

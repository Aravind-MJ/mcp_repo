import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { ArtifactAttachments } from "./attachments.js";
import { ServiceError } from "../errors.js";
import { createArtifactSignedUrl } from "../security.js";

export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9]{24}$/;
const LEGACY_ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const ARTIFACT_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateArtifactId(length = 24) {
  let result = "";
  while (result.length < length) {
    const bytes = randomBytes(Math.max(16, length - result.length));
    for (const byte of bytes) {
      // 248 is the largest multiple of 62 below 256, avoiding modulo bias.
      if (byte >= 248) continue;
      result += ARTIFACT_ID_ALPHABET[byte % ARTIFACT_ID_ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

export class ArtifactStore {
  constructor(config) {
    this.config = config;
    this.artifactsDir = path.join(config.dataDir, "artifact", "html");
    this.metadataDir = path.join(config.dataDir, "artifact", "metadata");
    this.versionsDir = path.join(config.dataDir, "artifact", "versions");
    this.updateLocks = new Map();
    this.attachments = new ArtifactAttachments(this);
  }

  async initialize() {
    for (const directory of [
      this.config.dataDir,
      path.dirname(this.artifactsDir),
      this.artifactsDir,
      this.metadataDir,
      this.versionsDir,
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
  }

  validateId(artifactId) {
    if (typeof artifactId !== "string" || !ARTIFACT_ID_PATTERN.test(artifactId)) {
      throw new ServiceError(404, "Artifact not found");
    }
    return artifactId;
  }

  validateVersion(version) {
    const parsed = typeof version === "number" ? version : Number.parseInt(version, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== String(version)) {
      throw new ServiceError(404, "Artifact version not found");
    }
    return parsed;
  }

  htmlPath(artifactId) {
    return path.join(this.artifactsDir, `${this.validateId(artifactId)}.html`);
  }

  metadataPath(artifactId) {
    return path.join(this.metadataDir, `${this.validateId(artifactId)}.json`);
  }

  versionDir(artifactId) {
    return path.join(this.versionsDir, this.validateId(artifactId));
  }

  versionHtmlPath(artifactId, version) {
    return path.join(this.versionDir(artifactId), `${this.validateVersion(version)}.html`);
  }

  versionMetadataPath(artifactId, version) {
    return path.join(this.versionDir(artifactId), `${this.validateVersion(version)}.json`);
  }

  async atomicWrite(destination, payload) {
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomBytes(12).toString("hex")}`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(payload);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, destination);
    } finally {
      await handle?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async allocateId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateArtifactId();
      try {
        await readFile(this.metadataPath(candidate));
      } catch (error) {
        if (error.code === "ENOENT") return candidate;
        throw error;
      }
    }
    throw new ServiceError(500, "Could not allocate an artifact ID");
  }

  normalizeHtml(html) {
    if (typeof html !== "string" || html.trim() === "") {
      throw new ServiceError(400, "html must be a non-empty string");
    }
    const payload = Buffer.from(html, "utf8");
    if (payload.length > this.config.maxHtmlBytes) {
      throw new ServiceError(413, `HTML exceeds the ${this.config.maxHtmlBytes}-byte limit`);
    }
    return payload;
  }

  normalizeTitle(title, fallback = "Untitled artifact") {
    if (typeof title !== "string") throw new ServiceError(400, "title must be a string");
    return title.trim().replace(/\s+/g, " ").slice(0, 120) || fallback;
  }

  normalizeTags(tags = []) {
    if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== "string" || !tag.isWellFormed() || /[\x00-\x1f\x7f]/.test(tag))) {
      throw new ServiceError(400, "tags must contain at most 20 strings without control characters");
    }
    const normalized = tags.map(tag => tag.trim().replace(/\s+/g, " ").toLowerCase());
    if (normalized.some(tag => tag.length === 0 || tag.length > 64)) {
      throw new ServiceError(400, "tags must be non-empty and at most 64 normalized characters");
    }
    return [...new Set(normalized)];
  }

  buildMetadata({ artifactId, title, payload, artifactCreatedAt, version, updatedAt, tags = [] }) {
    return {
      artifact_id: artifactId,
      title,
      tags,
      url: `${this.config.publicBaseUrl}/artifact/${artifactId}`,
      bytes: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      created_at: artifactCreatedAt,
      updated_at: updatedAt,
      version,
      version_url: `${this.config.publicBaseUrl}/artifact/${artifactId}/versions/${version}`,
    };
  }

  async writeVersion(artifactId, version, payload, metadata) {
    const directory = this.versionDir(artifactId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await this.atomicWrite(this.versionHtmlPath(artifactId, version), payload);
    try {
      await this.atomicWrite(
        this.versionMetadataPath(artifactId, version),
        Buffer.from(JSON.stringify(metadata), "utf8"),
      );
    } catch (error) {
      await unlink(this.versionHtmlPath(artifactId, version)).catch(() => {});
      throw error;
    }
  }

  async publish(html, title = "Untitled artifact", tags = []) {
    const payload = this.normalizeHtml(html);
    const cleanTitle = this.normalizeTitle(title);
    const artifactId = await this.allocateId();
    await this.attachments.validateReferences(artifactId, payload);
    const timestamp = new Date().toISOString();
    const metadata = this.buildMetadata({
      artifactId,
      title: cleanTitle,
      tags: this.normalizeTags(tags),
      payload,
      artifactCreatedAt: timestamp,
      version: 1,
      updatedAt: timestamp,
    });

    await this.writeVersion(artifactId, 1, payload, metadata);
    try {
      await this.atomicWrite(this.metadataPath(artifactId), Buffer.from(JSON.stringify(metadata), "utf8"));
    } catch (error) {
      await rm(this.versionDir(artifactId), { recursive: true, force: true });
      throw error;
    }
    return metadata;
  }

  async withUpdateLock(artifactId, operation) {
    const previous = this.updateLocks.get(artifactId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.updateLocks.set(artifactId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.updateLocks.get(artifactId) === current) this.updateLocks.delete(artifactId);
    }
  }

  async update(artifactId, html, title, tags) {
    const validatedId = this.validateId(artifactId);
    const payload = this.normalizeHtml(html);
    return this.withUpdateLock(validatedId, async () => {
      const currentMetadata = await this.readLatestMetadata(validatedId);
      await this.attachments.validateReferences(validatedId, payload);
      const cleanTitle = title === undefined
        ? currentMetadata.title
        : this.normalizeTitle(title, currentMetadata.title);
      const nextVersion = this.validateVersion(currentMetadata.version) + 1;
      const updatedAt = new Date().toISOString();
      const metadata = this.buildMetadata({
        artifactId: validatedId,
        title: cleanTitle,
        tags: tags === undefined ? (currentMetadata.tags || []) : this.normalizeTags(tags),
        payload,
        artifactCreatedAt: currentMetadata.created_at,
        version: nextVersion,
        updatedAt,
      });

      await this.writeVersion(validatedId, nextVersion, payload, metadata);
      try {
        // This single atomic pointer update makes the new version current.
        await this.atomicWrite(this.metadataPath(validatedId), Buffer.from(JSON.stringify(metadata), "utf8"));
      } catch (error) {
        await Promise.all([
          unlink(this.versionHtmlPath(validatedId, nextVersion)).catch(() => {}),
          unlink(this.versionMetadataPath(validatedId, nextVersion)).catch(() => {}),
        ]);
        throw error;
      }
      return metadata;
    });
  }

  parseMetadata(raw) {
    const metadata = JSON.parse(raw);
    const tags = Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === "string" && tag.isWellFormed()) : [];
    return { ...metadata, tags };
  }

  async readLatestMetadata(artifactId) {
    try {
      return this.parseMetadata(await readFile(this.metadataPath(artifactId), "utf8"));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(404, "Artifact not found");
    }
  }

  async read(artifactId, version) {
    try {
      const validatedId = this.validateId(artifactId);
      const latestMetadata = await this.readLatestMetadata(validatedId);
      const selectedVersion = version === undefined
        ? this.validateVersion(latestMetadata.version)
        : this.validateVersion(version);
      const [html, rawMetadata] = await Promise.all([
        readFile(this.versionHtmlPath(validatedId, selectedVersion)),
        readFile(this.versionMetadataPath(validatedId, selectedVersion), "utf8"),
      ]);
      return { html, metadata: this.parseMetadata(rawMetadata) };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(404, version === undefined ? "Artifact not found" : "Artifact version not found");
    }
  }

  async allMetadata() {
    let entries;
    try {
      entries = await readdir(this.metadataDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          return this.parseMetadata(await readFile(path.join(this.metadataDir, entry.name), "utf8"));
        } catch {
          return null;
        }
      }));
    return records.filter(Boolean)
      .sort((left, right) => (right.updated_at || right.created_at).localeCompare(left.updated_at || left.created_at));
  }

  async listWithTags(limit = 50, tag) {
    const selected = tag === undefined ? undefined : this.normalizeTags([tag])[0];
    const records = await this.allMetadata();
    const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 50, this.config.maxListItems));
    return {
      artifacts: records.filter(item => selected === undefined || item.tags.includes(selected)).slice(0, safeLimit),
      tags: [...new Set(records.flatMap(item => item.tags))].sort(),
    };
  }

  async list(limit = 50, tag) {
    return (await this.listWithTags(limit, tag)).artifacts;
  }

  async listVersions(artifactId) {
    const validatedId = this.validateId(artifactId);
    await this.readLatestMetadata(validatedId);
    const entries = await readdir(this.versionDir(validatedId), { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .map(async (entry) => this.parseMetadata(await readFile(path.join(this.versionDir(validatedId), entry.name), "utf8"))));
    return records.sort((left, right) => right.version - left.version);
  }

  async createSignedUrl(artifactId, expiresInSeconds, version) {
    const validatedId = this.validateId(artifactId);
    const selectedVersion = version === undefined ? undefined : this.validateVersion(version);
    await this.read(validatedId, selectedVersion);
    return createArtifactSignedUrl({
      artifactId: validatedId,
      ...(selectedVersion === undefined ? {} : { version: selectedVersion }),
      publicBaseUrl: this.config.publicBaseUrl,
      secretFile: this.config.secretFile,
      ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
    });
  }

  async delete(artifactId) {
    const validatedId = this.validateId(artifactId);
    return this.withUpdateLock(validatedId, async () => {
      const { metadata } = await this.read(validatedId);
      await Promise.all([
        unlink(this.metadataPath(validatedId)).catch((error) => { if (error.code !== "ENOENT") throw error; }),
        unlink(this.htmlPath(validatedId)).catch((error) => { if (error.code !== "ENOENT") throw error; }),
        rm(this.versionDir(validatedId), { recursive: true, force: true }),
        rm(this.attachments.artifactDir(validatedId), { recursive: true, force: true }),
      ]);
      return metadata;
    });
  }

  async migrateLegacyArtifacts() {
    const entries = await readdir(this.metadataDir, { withFileTypes: true });
    const migrated = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const legacyId = entry.name.slice(0, -5);
      if (ARTIFACT_ID_PATTERN.test(legacyId) || !LEGACY_ARTIFACT_ID_PATTERN.test(legacyId)) continue;

      const legacyHtmlPath = path.join(this.artifactsDir, `${legacyId}.html`);
      const legacyMetadataPath = path.join(this.metadataDir, `${legacyId}.json`);
      const [html, rawMetadata] = await Promise.all([
        readFile(legacyHtmlPath),
        readFile(legacyMetadataPath, "utf8"),
      ]);
      const previousMetadata = JSON.parse(rawMetadata);
      const newId = await this.allocateId();
      const timestamp = previousMetadata.created_at || new Date().toISOString();
      const metadata = this.buildMetadata({
        artifactId: newId,
        title: this.normalizeTitle(previousMetadata.title || "Untitled artifact"),
        payload: html,
        artifactCreatedAt: timestamp,
        version: 1,
        updatedAt: timestamp,
      });

      await this.writeVersion(newId, 1, html, metadata);
      try {
        await this.atomicWrite(this.metadataPath(newId), Buffer.from(JSON.stringify(metadata), "utf8"));
      } catch (error) {
        await rm(this.versionDir(newId), { recursive: true, force: true });
        throw error;
      }
      await Promise.all([unlink(legacyHtmlPath), unlink(legacyMetadataPath)]);
      migrated.push({ from: legacyId, to: newId });
    }
    return migrated;
  }
}

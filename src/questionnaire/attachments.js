import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ServiceError } from "../errors.js";
import { readSharedSecret } from "../security.js";

// Decoding runs on untrusted bytes: no cross-request pixel cache and one libvips worker per image.
sharp.cache(false);
sharp.concurrency(1);

// Conservative hard limits for respondent uploads. Per-question max_bytes/max_files sit below these.
export const UPLOAD_LIMITS = Object.freeze({
  capabilityTtlSeconds: 5 * 60,
  downloadTtlSeconds: 60 * 60,
  maxDimension: 10_000,
  maxPixels: 40_000_000,
  maxAttachmentsPerResponse: 100,
  maxBytesPerResponse: 100 * 1024 * 1024,
  maxAttachmentsPerQuestionnaire: 5_000,
  maxBytesPerQuestionnaire: 2 * 1024 * 1024 * 1024,
  concurrentPerResponse: 2,
  concurrentPerQuestionnaire: 8,
  concurrentPerSource: 4,
  concurrentGlobal: 16,
  uploadTimeoutMs: 2 * 60_000,
  reservationTtlMs: 10 * 60_000,
  abandonedDraftMs: 7 * 24 * 60 * 60_000,
  unreferencedGraceMs: 24 * 60 * 60_000,
  lifecycleIntervalMs: 60 * 60_000,
});

const ID_PATTERN = /^[A-Za-z0-9]{24}$/;
const ROW_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const FORMAT_TYPES = Object.freeze({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });
const ENCODERS = Object.freeze({
  jpeg: (image, quality) => image.jpeg({ quality }),
  png: (image) => image.png({ compressionLevel: 9 }),
  webp: (image, quality) => image.webp({ quality }),
});
// Lossy formats step down until the output fits max_bytes; PNG is lossless and gets one attempt.
const ENCODE_QUALITIES = Object.freeze({ jpeg: [90, 75, 60], png: [null], webp: [90, 75, 60] });

function serviceError(message, status = 400) {
  return new ServiceError(status, message);
}

// Recognises the formats we accept by magic bytes; everything else (SVG, GIF, HEIC, text) is refused
// before any decoder sees it.
export function sniffImageFormat(header) {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "jpeg";
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (header.length >= 12 && header.toString("latin1", 0, 4) === "RIFF" && header.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

function cleanFilename(value) {
  if (typeof value !== "string") return "image";
  const base = value.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").trim();
  return base.slice(0, 120) || "image";
}

function flattenQuestions(questions) {
  return questions.flatMap((question) => [question, ...flattenQuestions(question.children || [])]);
}

// Walks a validated answer object and yields every referenced attachment with its location.
export function attachmentReferences(questions, answers) {
  const references = [];
  for (const question of flattenQuestions(questions)) {
    const value = answers[question.id];
    if (question.type === "file_upload" && Array.isArray(value)) {
      for (const id of value) references.push({ id, question_id: question.id, row_id: "", field_id: "" });
    }
    if (question.type === "repeatable_rows" && Array.isArray(value)) {
      for (const row of value) {
        for (const field of question.fields) {
          if (field.type !== "file_upload" || !Array.isArray(row.values?.[field.id])) continue;
          for (const id of row.values[field.id]) references.push({ id, question_id: question.id, row_id: row.row_id, field_id: field.id });
        }
      }
    }
  }
  return references;
}

function publicMetadata(row) {
  return {
    attachment_id: row.id,
    question_id: row.question_id,
    row_id: row.row_id || null,
    field_id: row.field_id || null,
    filename: row.filename,
    content_type: row.content_type,
    width: Number(row.width),
    height: Number(row.height),
    bytes: Number(row.bytes),
    sha256: row.sha256,
  };
}

export class QuestionnaireAttachments {
  constructor(store) {
    this.store = store;
    this.directory = path.join(store.config.dataDir, "questionnaire", "attachments");
    this.limits = Object.freeze({ ...UPLOAD_LIMITS, ...(store.config.questionnaireUploadLimits || {}) });
  }

  get db() { return this.store.db; }
  now() { return this.store.clock(); }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS questionnaire_attachments (
        id TEXT PRIMARY KEY CHECK(length(id) = 24),
        questionnaire_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        response_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        row_id TEXT NOT NULL DEFAULT '',
        field_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('reserved','stored')),
        reserved_bytes INTEGER NOT NULL,
        bytes INTEGER,
        content_type TEXT,
        width INTEGER,
        height INTEGER,
        sha256 TEXT,
        filename TEXT,
        source_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        reservation_expires_at INTEGER,
        unreferenced_since INTEGER,
        FOREIGN KEY(response_id) REFERENCES responses(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS questionnaire_attachments_response_idx ON questionnaire_attachments(response_id, status);
      CREATE INDEX IF NOT EXISTS questionnaire_attachments_questionnaire_idx ON questionnaire_attachments(questionnaire_id, status);
      CREATE INDEX IF NOT EXISTS questionnaire_attachments_source_idx ON questionnaire_attachments(source_hash, status);
      CREATE INDEX IF NOT EXISTS questionnaire_attachments_unreferenced_idx ON questionnaire_attachments(unreferenced_since);
    `);
  }

  questionnaireDir(questionnaireId) { return path.join(this.directory, questionnaireId); }
  filePath(questionnaireId, attachmentId) { return path.join(this.questionnaireDir(questionnaireId), attachmentId); }

  // Finds the upload settings for a question or a row field in this exact revision.
  resolveTarget(questionnaire, { question_id: questionId, row_id: rowId, field_id: fieldId } = {}) {
    const question = flattenQuestions(questionnaire.questions).find((item) => item.id === questionId);
    const invalid = () => serviceError("question_id must name a file_upload question, or a repeatable_rows question with row_id and a file_upload field_id");
    if (!question) throw invalid();
    if (question.type === "file_upload") {
      if (rowId || fieldId) throw invalid();
      return { questionId, rowId: "", fieldId: "", settings: question.settings };
    }
    if (question.type !== "repeatable_rows") throw invalid();
    if (typeof rowId !== "string" || !ROW_ID_PATTERN.test(rowId)) throw serviceError("row_id must be 1-40 letters, numbers, dashes, or underscores");
    const field = question.fields.find((item) => item.id === fieldId);
    if (!field || field.type !== "file_upload") throw invalid();
    return { questionId, rowId, fieldId, settings: field.settings };
  }

  capabilityPayload(row, target, expires) {
    return `questionnaire-upload:${row.questionnaire_id}:${Number(row.revision)}:${row.id}:${target.questionId}:${target.rowId}:${target.fieldId}:${expires}`;
  }

  async hmac(payload) {
    return createHmac("sha256", await readSharedSecret(this.store.config.secretFile)).update(payload, "utf8").digest("hex");
  }

  assertWritable(questionnaire, row) {
    if (questionnaire.status !== "open") throw serviceError("This questionnaire is closed", 409);
    if (row.status !== "draft") throw serviceError("This response is already submitted", 409);
  }

  async grantCapability(questionnaire, row, body) {
    this.assertWritable(questionnaire, row);
    const target = this.resolveTarget(questionnaire, body);
    const expires = Math.floor(this.now() / 1000) + this.limits.capabilityTtlSeconds;
    return {
      question_id: target.questionId,
      row_id: target.rowId || null,
      field_id: target.fieldId || null,
      upload_expires: expires,
      upload_signature: await this.hmac(this.capabilityPayload(row, target, expires)),
      expires_at: new Date(expires * 1000).toISOString(),
      formats: target.settings.formats,
      max_bytes: target.settings.max_bytes,
    };
  }

  async verifyCapability(row, target, expires, signature) {
    if (typeof expires !== "string" || !/^\d{10}$/.test(expires) || Number(expires) < Math.floor(this.now() / 1000)) return false;
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = Buffer.from(await this.hmac(this.capabilityPayload(row, target, Number(expires))), "utf8");
    return timingSafeEqual(expected, Buffer.from(signature, "utf8"));
  }

  // Claims concurrency and storage headroom for one upload under the database write lock.
  reserve(row, target, sourceHash) {
    const limits = this.limits;
    const now = this.now();
    const attachmentId = this.store.allocateId("questionnaire_attachments");
    this.store.immediate(() => {
      const current = this.db.prepare("SELECT status FROM responses WHERE id = ?").get(row.id);
      if (!current) throw serviceError("Response not found", 404);
      if (current.status !== "draft") throw serviceError("This response is already submitted", 409);
      const live = "status = 'reserved' AND reservation_expires_at > ?";
      const count = (column, value) => Number(this.db.prepare(`SELECT count(*) AS n FROM questionnaire_attachments WHERE ${column} = ? AND ${live}`).get(value, now).n);
      // Counted from the database so every process and connection sharing it sees the same total.
      const global = Number(this.db.prepare(`SELECT count(*) AS n FROM questionnaire_attachments WHERE ${live}`).get(now).n);
      if (global >= limits.concurrentGlobal) throw serviceError("The server is processing too many uploads; try again shortly", 429);
      if (count("response_id", row.id) >= limits.concurrentPerResponse) throw serviceError(`At most ${limits.concurrentPerResponse} uploads can run at once for one response; wait for one to finish`, 429);
      if (count("questionnaire_id", row.questionnaire_id) >= limits.concurrentPerQuestionnaire) throw serviceError("Too many uploads are in progress for this questionnaire; try again shortly", 429);
      if (count("source_hash", sourceHash) >= limits.concurrentPerSource) throw serviceError("Too many uploads are in progress from this network; try again shortly", 429);
      const usage = (column, value) => this.usage(column, value, now);
      const reserved = target.settings.max_bytes;
      const forResponse = usage("response_id", row.id);
      if (Number(forResponse.n) >= limits.maxAttachmentsPerResponse || Number(forResponse.bytes) + reserved > limits.maxBytesPerResponse) {
        throw serviceError("This response has reached its upload storage limit; remove unused images first", 409);
      }
      const forQuestionnaire = usage("questionnaire_id", row.questionnaire_id);
      if (Number(forQuestionnaire.n) >= limits.maxAttachmentsPerQuestionnaire || Number(forQuestionnaire.bytes) + reserved > limits.maxBytesPerQuestionnaire) {
        throw serviceError("This questionnaire has reached its upload storage limit", 409);
      }
      this.db.prepare(`INSERT INTO questionnaire_attachments
        (id, questionnaire_id, revision, response_id, question_id, row_id, field_id, status, reserved_bytes, source_hash, created_at, reservation_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)`)
        .run(attachmentId, row.questionnaire_id, Number(row.revision), row.id, target.questionId, target.rowId, target.fieldId, reserved, sourceHash, now, now + limits.reservationTtlMs);
    });
    return attachmentId;
  }

  // Stored bytes plus live reservations, optionally leaving one reservation out.
  usage(column, value, now, excludeId = "") {
    return this.db.prepare(`SELECT count(*) AS n, coalesce(sum(CASE WHEN status = 'stored' THEN bytes ELSE reserved_bytes END), 0) AS bytes
      FROM questionnaire_attachments WHERE ${column} = ? AND id != ? AND (status = 'stored' OR (status = 'reserved' AND reservation_expires_at > ?))`).get(value, excludeId, now);
  }

  async receive({ questionnaire, row, query, request, sourceIp }) {
    this.assertWritable(questionnaire, row);
    const target = this.resolveTarget(questionnaire, { question_id: query.question_id, row_id: query.row_id, field_id: query.field_id });
    if (!(await this.verifyCapability(row, target, query.upload_expires, query.upload_signature))) {
      throw serviceError("The upload link is invalid or expired; request a new one", 403);
    }
    const { settings } = target;
    const declaredType = String(request.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const declaredFormat = settings.formats.find((format) => FORMAT_TYPES[format] === declaredType);
    if (!declaredFormat) {
      throw serviceError(`Upload a ${settings.formats.map((format) => format.toUpperCase()).join(", ")} image`, 415);
    }
    const declaredLength = Number(request.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > settings.max_bytes) throw serviceError(`Each image must be at most ${settings.max_bytes} bytes`, 413);
    const sourceHash = createHash("sha256").update(`questionnaire-upload-source:${String(sourceIp || "unknown")}`, "utf8").digest("hex");
    const attachmentId = this.reserve(row, target, sourceHash);
    const destination = this.filePath(row.questionnaire_id, attachmentId);
    const received = `${destination}.upload`;
    const encoded = `${destination}.encoded`;
    const timer = setTimeout(() => request.destroy(serviceError("The upload took too long", 408)), this.limits.uploadTimeoutMs);
    let stored = false;
    try {
      await mkdir(this.questionnaireDir(row.questionnaire_id), { recursive: true, mode: 0o700 });
      await this.stream(request, received, settings.max_bytes);
      clearTimeout(timer);
      const image = await this.reencode(received, encoded, settings.formats, declaredFormat, settings.max_bytes);
      const sha256 = createHash("sha256").update(await readFile(encoded)).digest("hex");
      await rename(encoded, destination);
      const now = this.now();
      const metadata = { filename: cleanFilename(query.filename), content_type: FORMAT_TYPES[image.format], width: image.width, height: image.height, bytes: image.size, sha256 };
      this.store.immediate(() => {
        const current = this.db.prepare("SELECT r.status, a.reserved_bytes FROM questionnaire_attachments a JOIN responses r ON r.id = a.response_id WHERE a.id = ? AND a.status = 'reserved'").get(attachmentId);
        if (!current) throw serviceError("Response not found", 404);
        if (current.status !== "draft") throw serviceError("This response is already submitted", 409);
        // Reconcile the real size against the reservation and the storage quotas before it counts as stored.
        if (metadata.bytes > Number(current.reserved_bytes)) throw serviceError(`The image is larger than ${current.reserved_bytes} bytes after processing`, 413);
        const forResponse = this.usage("response_id", row.id, now, attachmentId);
        if (Number(forResponse.n) + 1 > this.limits.maxAttachmentsPerResponse || Number(forResponse.bytes) + metadata.bytes > this.limits.maxBytesPerResponse) {
          throw serviceError("This response has reached its upload storage limit; remove unused images first", 409);
        }
        const forQuestionnaire = this.usage("questionnaire_id", row.questionnaire_id, now, attachmentId);
        if (Number(forQuestionnaire.n) + 1 > this.limits.maxAttachmentsPerQuestionnaire || Number(forQuestionnaire.bytes) + metadata.bytes > this.limits.maxBytesPerQuestionnaire) {
          throw serviceError("This questionnaire has reached its upload storage limit", 409);
        }
        // Unreferenced until an autosave places the ID in the answers.
        this.db.prepare(`UPDATE questionnaire_attachments SET status = 'stored', bytes = ?, content_type = ?, width = ?, height = ?, sha256 = ?, filename = ?,
          reservation_expires_at = NULL, unreferenced_since = ? WHERE id = ?`)
          .run(metadata.bytes, metadata.content_type, metadata.width, metadata.height, sha256, metadata.filename, now, attachmentId);
        this.db.prepare("UPDATE responses SET updated_at = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
      });
      stored = true;
      return { attachment_id: attachmentId, question_id: target.questionId, row_id: target.rowId || null, field_id: target.fieldId || null, ...metadata };
    } catch (error) {
      if (request.destroyed && !(error instanceof ServiceError)) throw serviceError("Upload interrupted", 400);
      throw error;
    } finally {
      clearTimeout(timer);
      await rm(received, { force: true });
      await rm(encoded, { force: true });
      if (!stored) {
        await rm(destination, { force: true });
        this.db?.prepare("DELETE FROM questionnaire_attachments WHERE id = ? AND status = 'reserved'").run(attachmentId);
      }
    }
  }

  // Writes the raw body to a private temporary file, counting real bytes rather than trusting headers.
  async stream(request, file, maxBytes) {
    const handle = await open(file, "wx", 0o600);
    let bytes = 0;
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw serviceError(`Each image must be at most ${maxBytes} bytes`, 413);
        await handle.write(chunk);
      }
      if (!request.complete) throw serviceError("Upload interrupted", 400);
      if (bytes === 0) throw serviceError("The upload was empty", 400);
    } finally {
      await handle.close();
    }
  }

  // Decodes the actual pixels within dimension bounds and writes a fresh encoding with no metadata.
  async reencode(input, output, formats, declaredFormat, maxBytes) {
    const header = Buffer.alloc(16);
    const handle = await open(input, "r");
    try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
    const format = sniffImageFormat(header);
    if (!format || !formats.includes(format)) {
      throw serviceError(`Upload a ${formats.map((item) => item.toUpperCase()).join(", ")} image; other formats such as SVG are not accepted`, 415);
    }
    if (format !== declaredFormat) throw serviceError("The image content does not match its declared type", 415);
    const { maxPixels, maxDimension } = this.limits;
    const source = () => sharp(input, { limitInputPixels: maxPixels, failOn: "error", sequentialRead: true, animated: false });
    const tooLarge = () => serviceError(`Images must be at most ${maxDimension} pixels per side and ${maxPixels} pixels in total`, 413);
    let metadata;
    try { metadata = await source().metadata(); }
    catch (error) {
      if (/pixel limit/i.test(String(error?.message))) throw tooLarge();
      throw serviceError("The image could not be decoded", 415);
    }
    if (metadata.format !== format) throw serviceError("The image content does not match its format", 415);
    if (!metadata.width || !metadata.height || metadata.width > maxDimension || metadata.height > maxDimension || metadata.width * metadata.height > maxPixels) throw tooLarge();
    for (const quality of ENCODE_QUALITIES[format]) {
      let info;
      try {
        // rotate() applies EXIF orientation before the encoder drops every metadata block.
        info = await ENCODERS[format](source().rotate(), quality).toFile(output);
      } catch {
        throw serviceError("The image could not be decoded", 415);
      }
      if (info.size <= maxBytes) return { format, width: info.width, height: info.height, size: info.size };
    }
    throw serviceError(`The image is larger than ${maxBytes} bytes after processing; upload a smaller or less detailed image`, 413);
  }

  // Returns a predicate the answer validator uses to check that an ID belongs to this response at this location.
  ownership(responseId) {
    if (!responseId) return () => false;
    const rows = this.db.prepare("SELECT id, question_id, row_id, field_id FROM questionnaire_attachments WHERE response_id = ? AND status = 'stored'").all(responseId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return (id, location) => {
      const row = byId.get(id);
      return Boolean(row && row.question_id === location.question_id && row.row_id === location.row_id && row.field_id === location.field_id);
    };
  }

  // Must run inside the caller's transaction, after the answers that reference attachments are written.
  syncReferences(responseId, questions, answers) {
    const referenced = attachmentReferences(questions, answers).map((reference) => reference.id);
    const now = this.now();
    const placeholders = referenced.map(() => "?").join(", ");
    if (referenced.length) {
      this.db.prepare(`UPDATE questionnaire_attachments SET unreferenced_since = NULL WHERE response_id = ? AND id IN (${placeholders})`).run(responseId, ...referenced);
    }
    this.db.prepare(`UPDATE questionnaire_attachments SET unreferenced_since = ? WHERE response_id = ? AND status = 'stored' AND unreferenced_since IS NULL${referenced.length ? ` AND id NOT IN (${placeholders})` : ""}`)
      .run(now, responseId, ...referenced);
  }

  forEdit(responseId) {
    const rows = this.db.prepare("SELECT * FROM questionnaire_attachments WHERE response_id = ? AND status = 'stored' ORDER BY created_at, id").all(responseId);
    return Object.fromEntries(rows.map((row) => [row.id, publicMetadata(row)]));
  }

  referenced(responseId) {
    return this.db.prepare("SELECT * FROM questionnaire_attachments WHERE response_id = ? AND status = 'stored' AND unreferenced_since IS NULL ORDER BY created_at, id")
      .all(responseId).map(publicMetadata);
  }

  stored(questionnaireId, attachmentId) {
    if (typeof attachmentId !== "string" || !ID_PATTERN.test(attachmentId)) return null;
    return this.db.prepare("SELECT * FROM questionnaire_attachments WHERE id = ? AND questionnaire_id = ? AND status = 'stored'").get(attachmentId, questionnaireId) ?? null;
  }

  downloadPayload(row, expires) {
    return `questionnaire-attachment:${row.questionnaire_id}:${row.response_id}:${row.id}:${expires}`;
  }

  async withDownloadUrls(questionnaireId, attachments) {
    const expires = Math.floor(this.now() / 1000) + this.limits.downloadTtlSeconds;
    return Promise.all(attachments.map(async (attachment) => {
      const row = this.stored(questionnaireId, attachment.attachment_id);
      const signature = await this.hmac(this.downloadPayload(row, expires));
      return {
        ...attachment,
        download_url: `${this.store.config.publicBaseUrl}/questionnaire/${questionnaireId}/attachments/${attachment.attachment_id}?expires=${expires}&signature=${signature}`,
        expires_at: new Date(expires * 1000).toISOString(),
      };
    }));
  }

  async authorizedDownload(questionnaireId, attachmentId, query) {
    const row = this.stored(questionnaireId, attachmentId);
    if (!row) return null;
    if (typeof query.expires !== "string" || !/^\d{10}$/.test(query.expires) || Number(query.expires) < Math.floor(this.now() / 1000)) return null;
    if (typeof query.signature !== "string" || !/^[a-f0-9]{64}$/.test(query.signature)) return null;
    const expected = Buffer.from(await this.hmac(this.downloadPayload(row, Number(query.expires))), "utf8");
    return timingSafeEqual(expected, Buffer.from(query.signature, "utf8")) ? row : null;
  }

  removeFiles(rows) {
    for (const row of rows) {
      for (const suffix of ["", ".upload", ".encoded"]) rmSync(`${this.filePath(row.questionnaire_id, row.id)}${suffix}`, { force: true });
    }
  }

  removeQuestionnaireFiles(questionnaireId) {
    rmSync(this.questionnaireDir(questionnaireId), { recursive: true, force: true });
  }

  rowsForResponse(responseId) {
    return this.db.prepare("SELECT id, questionnaire_id FROM questionnaire_attachments WHERE response_id = ?").all(responseId);
  }

  // Applies retention: stale reservations, upload-bearing abandoned drafts, unreferenced files past
  // their grace period, and files on disk that no database row owns. Eligibility is decided and rows
  // are deleted under one write lock, and files are removed only for rows that were actually deleted.
  runLifecycle(now = this.now()) {
    const limits = this.limits;
    const cutoff = new Date(now - limits.abandonedDraftMs).toISOString();
    const removed = this.store.immediate(() => {
      const expiredReservations = this.db.prepare("DELETE FROM questionnaire_attachments WHERE status = 'reserved' AND reservation_expires_at <= ? RETURNING id, questionnaire_id").all(now);
      const abandonedFiles = this.db.prepare(`SELECT a.id, a.questionnaire_id FROM questionnaire_attachments a JOIN responses r ON r.id = a.response_id
        WHERE r.status = 'draft' AND r.updated_at < ?`).all(cutoff);
      const abandoned = this.db.prepare(`DELETE FROM responses WHERE status = 'draft' AND updated_at < ?
        AND EXISTS (SELECT 1 FROM questionnaire_attachments a WHERE a.response_id = responses.id) RETURNING id`).all(cutoff);
      const unreferenced = this.db.prepare("DELETE FROM questionnaire_attachments WHERE status = 'stored' AND unreferenced_since <= ? RETURNING id, questionnaire_id").all(now - limits.unreferencedGraceMs);
      return { expiredReservations, abandonedFiles, abandoned, unreferenced };
    });
    this.removeFiles([...removed.expiredReservations, ...removed.abandonedFiles, ...removed.unreferenced]);
    const { expiredReservations, abandoned, unreferenced } = removed;

    let orphans = 0;
    let directories = [];
    try { directories = readdirSync(this.directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const questionnaireExists = this.db.prepare("SELECT 1 FROM questionnaires WHERE id = ?");
    const attachmentExists = this.db.prepare("SELECT 1 FROM questionnaire_attachments WHERE id = ? AND questionnaire_id = ?");
    for (const directory of directories) {
      if (!ID_PATTERN.test(directory)) continue;
      if (!questionnaireExists.get(directory)) {
        this.removeQuestionnaireFiles(directory);
        orphans += 1;
        continue;
      }
      for (const name of readdirSync(this.questionnaireDir(directory))) {
        const match = name.match(/^([A-Za-z0-9]{24})(?:\.upload|\.encoded)?$/);
        if (match && attachmentExists.get(match[1], directory)) continue;
        if (match) {
          rmSync(path.join(this.questionnaireDir(directory), name), { force: true });
          orphans += 1;
        }
      }
    }
    return {
      expired_reservations: expiredReservations.length,
      abandoned_drafts: abandoned.length,
      unreferenced_attachments: unreferenced.length,
      orphan_files: orphans,
    };
  }

  ensureDirectory() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
}

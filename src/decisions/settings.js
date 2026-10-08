import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ServiceError } from "../errors.js";
import { readSharedSecret } from "../security.js";

export const DEFAULT_DECISION_MODEL = "cloudflare/clef-flash";
export const DECISION_MODELS = Object.freeze({
  "cloudflare/clef-flash": "Cloudflare Clef Flash",
  "typesafe/jev-1.13": "TypeSafe Jev 1.13",
});
export const DECISION_LOG_PATH = "/artifacts/decisions/logs";

export class DecisionSettings {
  constructor(config) {
    this.file = path.join(config.dataDir, "decisions", "settings.json");
  }

  async getModel() {
    let text;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return DEFAULT_DECISION_MODEL;
      throw new ServiceError(500, "Decision model settings are unavailable");
    }
    try {
      if (Buffer.byteLength(text) > 4096) throw new Error();
      const { model } = JSON.parse(text);
      if (!Object.hasOwn(DECISION_MODELS, model)) throw new Error();
      return model;
    } catch {
      throw new ServiceError(500, "Decision model settings are invalid");
    }
  }

  async setModel(model) {
    if (typeof model !== "string" || !Object.hasOwn(DECISION_MODELS, model)) {
      throw new ServiceError(400, "Choose a supported decision model");
    }
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ model })}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
}

export async function modelCsrfToken(secretFile, expires = Math.floor(Date.now() / 1000) + 900) {
  const secret = await readSharedSecret(secretFile);
  const signature = createHmac("sha256", secret).update(`decision-default-model:${expires}`).digest("hex");
  return `${expires}.${signature}`;
}

export async function modelCsrfValid(secretFile, token) {
  if (typeof token !== "string" || !/^\d{10}\.[a-f0-9]{64}$/.test(token)) return false;
  const expires = Number(token.split(".")[0]);
  const now = Math.floor(Date.now() / 1000);
  if (expires < now || expires > now + 900) return false;
  const expected = Buffer.from(await modelCsrfToken(secretFile, expires));
  const supplied = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

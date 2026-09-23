import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_JEV_MODEL, decisionMetadata } from "./client.js";

const METADATA_COLUMNS = ["served_model", "provider", "generation_id", "input_tokens", "output_tokens", "total_tokens", "cost_usd"];
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_REQUEST_ID_LENGTH = 256;
const UNRECORDED_CALL = "The audit log could not record this call, so it was not sent to OpenRouter.";
const REUSED_REQUEST_ID = "Another message in the same request reused this JSON-RPC ID, so the call was not run.";
const INTERRUPTED_CALL = "The service stopped before this call's outcome was recorded.";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Costs are handled as the digits of each number's shortest round-trip form, so 1.2e-8
// prints as 0.000000012 and a total carries no binary floating-point residue.
function decimalParts(value) {
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length - Number(exponent) };
}

function formatDecimal({ units, scale }) {
  if (scale <= 0) return (units * 10n ** BigInt(-scale)).toString();
  const digits = units.toString().padStart(scale + 1, "0");
  const decimals = digits.slice(-scale).replace(/0+$/, "");
  return decimals ? `${digits.slice(0, -scale)}.${decimals}` : digits.slice(0, -scale);
}

export function exactDecimal(value) {
  return formatDecimal(decimalParts(value));
}

function exactDecimalSum(values) {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const units = parts.reduce((total, part) => total + part.units * 10n ** BigInt(scale - part.scale), 0n);
  return formatDecimal({ units, scale });
}

function isRequest(message) {
  return isPlainObject(message) && typeof message.method === "string" && Object.hasOwn(message, "id");
}

function isToolCall(message) {
  return isRequest(message) && message.method === "tools/call";
}

function requestKey(id) {
  return JSON.stringify(id);
}

function storedRequestId(id) {
  if (Number.isSafeInteger(id) || (typeof id === "string" && id.length <= MAX_REQUEST_ID_LENGTH)) return JSON.stringify(id);
  return null;
}

function boundedMessage(message) {
  const text = String(message || "The tool call failed");
  return text.length > MAX_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…` : text;
}

function responseError(message) {
  if (isPlainObject(message.error)) return message.error.message;
  return message.result?.content?.find?.((item) => item?.type === "text")?.text;
}

function requestedModel(params) {
  if (params.name !== "make_decisions" || !isPlainObject(params.arguments)) return null;
  const { model } = params.arguments;
  if (model === undefined) return DEFAULT_JEV_MODEL;
  return typeof model === "string" ? model : null;
}

class AuditedToolCalls {
  constructor(log, entries) {
    this.log = log;
    this.entries = new Map(entries.map((entry) => [entry.key, entry]));
  }

  // The tool handler must claim its audit record before calling OpenRouter.
  claim(requestId) {
    const entry = this.entries.get(requestKey(requestId));
    if (entry?.state !== "received") throw new Error(entry?.state === "rejected" ? REUSED_REQUEST_ID : UNRECORDED_CALL);
    entry.state = "claimed";
    return {
      succeed: (payload) => this.finish(entry, { status: "success", result: payload }),
      fail: (error) => this.finish(entry, { status: "failure", message: error.message, metadata: error.metadata }),
    };
  }

  // Calls rejected before the tool handler runs (unknown tool, invalid arguments)
  // are finalized from the response the MCP server sends for them.
  watch(transport) {
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      const entry = Object.hasOwn(message, "id") ? this.entries.get(requestKey(message.id)) : undefined;
      if (entry?.state === "received" && ("result" in message || "error" in message)) {
        this.finish(entry, { status: "failure", message: responseError(message) });
      }
      return send(message, options);
    };
    return transport;
  }

  // Runs once the HTTP exchange is over. A call still waiting here never reached the
  // tool handler, so no OpenRouter request was made for it; a claimed call is left for
  // its handler to finalize.
  finishUnanswered(statusCode) {
    for (const entry of this.entries.values()) {
      if (entry.state !== "received") continue;
      this.finish(entry, {
        status: "failure",
        message: statusCode >= 400
          ? `The MCP request ended with HTTP ${statusCode} before the tool ran.`
          : "The connection closed before the MCP server handled this call.",
      });
    }
  }

  // A record that cannot be finalized stays pending and is flagged for review;
  // the caller still receives the result it already paid for.
  finish(entry, outcome) {
    entry.state = "finished";
    try {
      this.log.finish(entry, outcome);
    } catch (error) {
      console.error(`Jev audit log could not finalize call ${entry.id}: ${error.message}`);
    }
  }
}

export class JevAuditLog {
  constructor(config) {
    this.databasePath = path.join(config.dataDir, "jev", "audit.sqlite3");
    this.db = null;
  }

  async initialize() {
    await mkdir(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.databasePath), 0o700);
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    await chmod(this.databasePath, 0o600);
    await Promise.all([
      chmod(`${this.databasePath}-wal`, 0o600).catch(() => {}),
      chmod(`${this.databasePath}-shm`, 0o600).catch(() => {}),
    ]);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        rpc_id TEXT,
        tool_name TEXT,
        arguments_json TEXT,
        requested_model TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','success','failure')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER CHECK(duration_ms >= 0),
        result_json TEXT,
        error_message TEXT,
        served_model TEXT,
        provider TEXT,
        generation_id TEXT,
        input_tokens INTEGER CHECK(input_tokens >= 0),
        output_tokens INTEGER CHECK(output_tokens >= 0),
        total_tokens INTEGER CHECK(total_tokens >= 0),
        cost_usd REAL CHECK(cost_usd >= 0)
      ) STRICT;
    `);
    // One service process owns this database, so a call still pending at startup was
    // interrupted or its final write failed. Either way its outcome is unknown.
    this.db.prepare("UPDATE tool_calls SET status = 'failure', error_message = ? WHERE status = 'pending'").run(INTERRUPTED_CALL);
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  receive(body) {
    const messages = Array.isArray(body) ? body : [body];
    // Responses are matched to calls by JSON-RPC ID, so a reused ID makes a call unattributable.
    const idUses = new Map();
    for (const message of messages.filter(isRequest)) {
      const key = requestKey(message.id);
      idUses.set(key, (idUses.get(key) ?? 0) + 1);
    }
    const entries = messages.filter(isToolCall).map((message) => {
      const key = requestKey(message.id);
      return { id: randomUUID(), key, state: idUses.get(key) > 1 ? "rejected" : "received", startedAt: Date.now(), message };
    });
    if (!entries.length) return new AuditedToolCalls(this, entries);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const insert = this.db.prepare(`INSERT INTO tool_calls (id, rpc_id, tool_name, arguments_json, requested_model, status, started_at, completed_at, duration_ms, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const { id, state, startedAt, message } of entries) {
          const params = isPlainObject(message.params) ? message.params : {};
          const startedAtText = new Date(startedAt).toISOString();
          const rejected = state === "rejected";
          insert.run(
            id,
            storedRequestId(message.id),
            typeof params.name === "string" ? params.name : null,
            params.arguments === undefined ? null : JSON.stringify(params.arguments),
            requestedModel(params),
            rejected ? "failure" : "pending",
            startedAtText,
            rejected ? startedAtText : null,
            rejected ? 0 : null,
            rejected ? REUSED_REQUEST_ID : null,
          );
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      console.error(`Jev audit log could not record tool calls: ${error.message}`);
      return new AuditedToolCalls(this, []);
    }
    return new AuditedToolCalls(this, entries);
  }

  finish(entry, { status, result, message, metadata: failureMetadata }) {
    const completedAt = Date.now();
    const metadata = (result === undefined ? failureMetadata : decisionMetadata(result)) ?? {};
    this.db.prepare(`UPDATE tool_calls SET status = ?, completed_at = ?, duration_ms = ?, result_json = ?, error_message = ?, ${METADATA_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND status = 'pending'`)
      .run(
        status,
        new Date(completedAt).toISOString(),
        Math.max(0, completedAt - entry.startedAt),
        result === undefined ? null : JSON.stringify(result),
        status === "failure" ? boundedMessage(message) : null,
        ...METADATA_COLUMNS.map((column) => metadata[column] ?? null),
        entry.id,
      );
  }

  summary() {
    const row = this.db.prepare(`SELECT count(*) AS total, sum(status = 'success') AS succeeded, sum(status = 'failure') AS failed,
      sum(status = 'pending') AS pending FROM tool_calls`).get();
    const costs = this.db.prepare("SELECT cost_usd FROM tool_calls WHERE cost_usd IS NOT NULL").all().map((cost) => cost.cost_usd);
    return {
      total: Number(row.total),
      succeeded: Number(row.succeeded ?? 0),
      failed: Number(row.failed ?? 0),
      pending: Number(row.pending ?? 0),
      costed: costs.length,
      total_cost_usd: costs.length ? exactDecimalSum(costs) : null,
    };
  }

  list({ limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 50, 100));
    const safeOffset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0);
    const calls = this.db.prepare("SELECT * FROM tool_calls ORDER BY seq DESC LIMIT ? OFFSET ?").all(safeLimit, safeOffset);
    const total = Number(this.db.prepare("SELECT count(*) AS count FROM tool_calls").get().count);
    return { calls, total, limit: safeLimit, offset: safeOffset, has_more: safeOffset + calls.length < total };
  }
}

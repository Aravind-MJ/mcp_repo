import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createSmtpMailer } from "../src/questionnaire/mailer.js";

let root;
let smtp;

// Minimal local SMTP peer for exercising the network boundary. It never relays mail.
function startFakeSmtp({ rejectRecipient = false } = {}) {
  const state = { messages: [], auth: [] };
  const server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    const envelope = { from: "", to: [] };
    socket.write("220 fake.smtp.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            state.messages.push({ ...envelope, data });
            socket.write("250 2.0.0 queued\r\n");
          } else data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") socket.write("250-fake.smtp.test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (command === "AUTH") {
          state.auth.push(Buffer.from(line.split(" ")[2] || "", "base64").toString("utf8"));
          socket.write("235 2.7.0 ok\r\n");
        } else if (command === "MAIL") { envelope.from = line; socket.write("250 ok\r\n"); }
        else if (command === "RCPT") {
          envelope.to.push(line);
          socket.write(rejectRecipient ? "550 5.1.1 no such user\r\n" : "250 ok\r\n");
        } else if (command === "DATA") { inData = true; data = ""; socket.write("354 go\r\n"); }
        else if (command === "QUIT") { socket.end("221 bye\r\n"); }
        else if (command === "RSET" || command === "NOOP") socket.write("250 ok\r\n");
        else socket.write("502 unsupported\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "questionnaire-mailer-test-"));
});

afterEach(async () => {
  if (smtp) await new Promise((resolve) => smtp.server.close(resolve));
  smtp = null;
  await rm(root, { recursive: true, force: true });
});

test("loadConfig reads generic SMTP settings with a password file path, never a password value", () => {
  const config = loadConfig({
    MCP_HUB_RUNTIME_DIR: "/srv/hub",
    QUESTIONNAIRE_SMTP_HOST: "smtp.gmail.com",
    QUESTIONNAIRE_SMTP_PORT: "465",
    QUESTIONNAIRE_SMTP_USER: "someone@gmail.com",
    QUESTIONNAIRE_SMTP_FROM: "Forms <someone@gmail.com>",
    QUESTIONNAIRE_SMTP_PASSWORD: "ignored-plain-value",
  });
  assert.equal(config.questionnaireSmtp.host, "smtp.gmail.com");
  assert.equal(config.questionnaireSmtp.port, 465);
  assert.equal(config.questionnaireSmtp.secure, true);
  assert.equal(config.questionnaireSmtp.requireTLS, true);
  assert.equal(config.questionnaireSmtp.passwordFile, "/srv/hub/secrets/questionnaire-smtp-password");
  assert.doesNotMatch(JSON.stringify(config), /ignored-plain-value/);
  assert.equal(loadConfig({}).questionnaireSmtp.host, "");
  assert.equal(loadConfig({ QUESTIONNAIRE_SMTP_PORT: "587", QUESTIONNAIRE_SMTP_HOST: "h" }).questionnaireSmtp.secure, false);
  assert.equal(loadConfig({}).decisionsTimeoutMs, 30_000, "keeps unrelated settings");
  assert.equal(loadConfig({}).trustProxy, "loopback");
  assert.equal(loadConfig({ MCP_HUB_TRUST_PROXY: "false" }).trustProxy, false);
  assert.equal(loadConfig({ MCP_HUB_TRUST_PROXY: "10.0.0.0/8" }).trustProxy, "10.0.0.0/8");
});

test("an unconfigured adapter reports delivery unavailable", async () => {
  const mailer = createSmtpMailer({ host: "", from: "" });
  assert.equal(mailer.configured, false);
  await assert.rejects(mailer.sendVerificationCode({ to: "a@example.com", code: "123456", questionnaireTitle: "T", expiresInMinutes: 10 }), (error) => error.status === 503);
});

test("delivers a plain-text code through SMTP using the password file", async () => {
  smtp = await startFakeSmtp();
  const passwordFile = path.join(root, "smtp-password");
  await writeFile(passwordFile, "app-password-fixture\n", { mode: 0o600 });
  const logs = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const key of Object.keys(original)) console[key] = (...args) => logs.push(args.join(" "));
  try {
    const mailer = createSmtpMailer({ host: "127.0.0.1", port: smtp.port, secure: false, requireTLS: false, user: "forms@example.com", passwordFile, from: "Forms <forms@example.com>" });
    assert.equal(mailer.configured, true);
    await mailer.sendVerificationCode({ to: "ada@example.com", code: "482913", questionnaireTitle: "Team survey", expiresInMinutes: 10 });
  } finally {
    Object.assign(console, original);
  }
  assert.equal(smtp.state.messages.length, 1);
  const [message] = smtp.state.messages;
  assert.match(message.to[0], /ada@example\.com/);
  assert.match(message.data, /482913/);
  assert.match(message.data, /Team survey/);
  assert.match(message.data, /10 minutes/);
  assert.match(message.data, /Content-Type: multipart\/alternative/);
  assert.match(message.data, /Content-Type: text\/plain/);
  assert.match(message.data, /Content-Type: text\/html/);
  assert.deepEqual(smtp.state.auth, ["\0forms@example.com\0app-password-fixture"]);
  assert.doesNotMatch(logs.join("\n"), /482913|app-password-fixture/);
});

test("maps SMTP rejection to a delivery failure that does not claim the code was sent", async () => {
  smtp = await startFakeSmtp({ rejectRecipient: true });
  const mailer = createSmtpMailer({ host: "127.0.0.1", port: smtp.port, secure: false, requireTLS: false, from: "forms@example.com" });
  await assert.rejects(
    mailer.sendVerificationCode({ to: "ada@example.com", code: "482913", questionnaireTitle: "T", expiresInMinutes: 10 }),
    (error) => error.status === 502 && /could not be sent/i.test(error.message) && !/482913/.test(error.message),
  );
});

test("a missing password file is reported as unavailable without exposing the path contents", async () => {
  const mailer = createSmtpMailer({ host: "127.0.0.1", port: 1, user: "u", passwordFile: path.join(root, "missing"), from: "f@example.com" });
  await assert.rejects(mailer.sendVerificationCode({ to: "a@example.com", code: "1", questionnaireTitle: "T", expiresInMinutes: 10 }), (error) => error.status === 503);
});

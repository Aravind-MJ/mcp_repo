import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import { ServiceError } from "../errors.js";
import { renderVerificationEmail } from "./email-template.js";

const UNAVAILABLE = "Email verification is unavailable right now. No code was sent.";
const FAILED = "The verification email could not be sent. No code was sent; try again later.";

// Provider-independent SMTP delivery for questionnaire verification codes.
// The password lives in a file and is read per send; codes and credentials are never logged.
export function createSmtpMailer(settings = {}) {
  const host = settings.host || "";
  const from = settings.from || "";
  const configured = Boolean(host && from);

  async function password() {
    if (!settings.user) return undefined;
    try {
      const value = (await readFile(settings.passwordFile, "utf8")).trim();
      if (!value) throw new Error("empty");
      return value;
    } catch {
      throw new ServiceError(503, UNAVAILABLE);
    }
  }

  return {
    configured,
    async sendVerificationCode({ to, code, questionnaireTitle, expiresInMinutes }) {
      // Defence in depth: deliver only when Nodemailer reads the recipient as this exact single mailbox,
      // so delivery, rate limits, and proofs all refer to the same address.
      const parsed = typeof to === "string" ? addressparser(to) : [];
      if (parsed.length !== 1 || parsed[0].group || parsed[0].name || parsed[0].address !== to) {
        throw new ServiceError(400, "respondent email must be a single plain email address");
      }
      if (!configured) throw new ServiceError(503, UNAVAILABLE);
      const pass = await password();
      const transport = nodemailer.createTransport({
        host,
        port: settings.port ?? 587,
        secure: settings.secure ?? settings.port === 465,
        requireTLS: settings.requireTLS ?? true,
        ...(settings.user ? { auth: { user: settings.user, pass } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        logger: false,
        debug: false,
      });
      try {
        await transport.sendMail({
          from,
          to,
          ...renderVerificationEmail({ code, questionnaireTitle, expiresInMinutes }),
        });
      } catch (error) {
        console.error(`questionnaire verification email delivery failed${error?.code ? ` (${error.code})` : ""}`);
        throw new ServiceError(502, FAILED);
      } finally {
        transport.close();
      }
    },
  };
}

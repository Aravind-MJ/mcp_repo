import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { renderVerificationEmail } from "../src/questionnaire/email-template.js";
import { QUESTIONNAIRE_CSS } from "../src/questionnaire/theme.js";

const input = { code: "123456", questionnaireTitle: "Team survey", expiresInMinutes: 10 };

async function build(message) {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await transport.sendMail({ from: "Forms <forms@example.com>", to: "ada@example.com", subject: "s", ...message });
  return info.message.toString("utf8");
}

test("html uses the Questionnaire Mocha palette from theme.js with inline styles and tables", () => {
  const { html } = renderVerificationEmail(input);
  for (const token of ["--base", "--mantle", "--surface0", "--text", "--subtext0", "--mauve", "--crust"]) {
    const value = QUESTIONNAIRE_CSS.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))[1];
    assert.ok(html.toLowerCase().includes(value.toLowerCase()), `${token} ${value}`);
  }
  assert.match(html, /<table[^>]*role="presentation"/);
  assert.match(html, /style="/);
  assert.match(html, />Questionnaire</);
  assert.match(html, /ui-sans-serif|system-ui|Segoe UI/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /@media \(max-width: 480px\)/);
});

test("inline style attributes contain no nested double quotes", () => {
  const { html } = renderVerificationEmail(input);
  for (const [, value] of html.matchAll(/style="([^>]*?)">/g)) assert.doesNotMatch(value, /"/);
  assert.doesNotMatch(html, /"Segoe UI"|"Liberation Mono"/);
});

test("html has a real h1, a clean wordmark and an instruction sentence", () => {
  const { html, text } = renderVerificationEmail(input);
  assert.match(html, /<h1[^>]*>Verify your email<\/h1>/);
  assert.doesNotMatch(html, /Verification code<|text-transform/);
  assert.doesNotMatch(html, /&#9632;|■|&nbsp;/);
  assert.match(html, />Questionnaire<\/span>/);
  const sentence = "Enter this code in the questionnaire to verify your email before submitting.";
  assert.ok(html.includes(sentence));
  assert.ok(text.includes(sentence));
});

test("html has no scripts, remote resources, or external references", () => {
  const { html } = renderVerificationEmail(input);
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|@import|@font-face|url\(|https?:\/\/|src=/i);
});

test("html and text carry the code, title, expiry, single use and safety guidance", () => {
  const { html, text } = renderVerificationEmail(input);
  for (const body of [html, text]) {
    assert.match(body, /123456/);
    assert.match(body, /Team survey/);
    assert.match(body, /10 minutes/);
    assert.match(body, /once/i);
    assert.match(body, /do not share/i);
    assert.match(body, /did not request/i);
  }
  assert.match(text, /^Your verification code for "Team survey" is:/);
});

test("hostile titles are escaped in html and left literal in text", () => {
  const title = `<script>alert(1)</script> "x" & <img src=x onerror=y>`;
  const { html, text } = renderVerificationEmail({ ...input, questionnaireTitle: title });
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; &amp; &lt;img src=x onerror=y&gt;/);
  assert.ok(text.includes(title));
});

test("hostile code and expiry values are escaped", () => {
  const { html } = renderVerificationEmail({ code: "<b>1</b>", questionnaireTitle: "T", expiresInMinutes: "<i>9</i>" });
  assert.doesNotMatch(html, /<b>1|<i>9/);
});

test("long unbroken titles wrap", () => {
  const { html } = renderVerificationEmail({ ...input, questionnaireTitle: "A".repeat(300) });
  assert.match(html, /word-break:\s*break-word|overflow-wrap:\s*anywhere/);
  assert.match(html, /max-width:\s*100%|width="100%"/);
});

test("nodemailer builds a multipart/alternative message with text before html", async () => {
  const { text, html } = renderVerificationEmail(input);
  const raw = await build({ text, html });
  assert.match(raw, /Content-Type: multipart\/alternative/);
  const plain = raw.indexOf("Content-Type: text/plain");
  const rich = raw.indexOf("Content-Type: text/html");
  assert.ok(plain > 0 && rich > plain);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/);
});

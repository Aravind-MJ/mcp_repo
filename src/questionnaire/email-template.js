// Verification email content. Colours are the Catppuccin Mocha values from theme.js,
// written inline because mail clients ignore custom properties and external CSS.
const C = {
  crust: "#11111b",
  mantle: "#181825",
  base: "#1e1e2e",
  surface0: "#313244",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  mauve: "#cba6f7",
  peach: "#fab387",
};
const FONT = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const WRAP = "word-break:break-word;overflow-wrap:anywhere;";

export const VERIFICATION_SUBJECT = "Your questionnaire verification code";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function renderVerificationEmail({ code, questionnaireTitle, expiresInMinutes }) {
  const text = [
    `Your verification code for "${questionnaireTitle}" is:`,
    "",
    `    ${code}`,
    "",
    "Enter this code in the questionnaire to verify your email before submitting.",
    "",
    `The code expires in ${expiresInMinutes} minutes and works once.`,
    "Do not share this code with anyone.",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");

  const title = escapeHtml(questionnaireTitle);
  const safeCode = escapeHtml(code);
  const minutes = escapeHtml(expiresInMinutes);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(VERIFICATION_SUBJECT)}</title>
<style>
@media (max-width: 480px) {
  .outer { padding: 12px 8px !important; }
  .card { padding: 24px 18px !important; }
  .code { font-size: 30px !important; letter-spacing: 6px !important; padding: 14px 8px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.crust};color:${C.text};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.crust};">
<tr><td class="outer" align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
    <tr><td style="background-color:${C.mantle};border:1px solid ${C.surface0};border-bottom:0;border-radius:12px 12px 0 0;padding:16px 28px;font-family:${FONT};font-size:14px;font-weight:650;letter-spacing:-0.02em;color:${C.text};">
      <span style="color:${C.text};">Questionnaire</span>
    </td></tr>
    <tr><td class="card" style="background-color:${C.base};border:1px solid ${C.surface0};border-radius:0 0 12px 12px;padding:32px 28px;font-family:${FONT};">
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;font-weight:700;color:${C.text};">Verify your email</h1>
      <p style="margin:0 0 24px;font-size:18px;line-height:1.5;font-weight:650;color:${C.text};${WRAP}">${title}</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${C.text};">Enter this code in the questionnaire to verify your email before submitting.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="code" align="center" style="background-color:${C.mantle};border:1px solid ${C.mauve};border-radius:10px;padding:18px 12px;font-family:${MONO};font-size:36px;line-height:1.2;font-weight:700;letter-spacing:10px;color:${C.mauve};${WRAP}">${safeCode}</td></tr>
      </table>
      <p style="margin:24px 0 8px;font-size:15px;line-height:1.6;color:${C.text};">This code expires in ${minutes} minutes and works once.</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${C.peach};">Do not share this code with anyone.</p>
      <p style="margin:0;padding-top:16px;border-top:1px solid ${C.surface0};font-size:13px;line-height:1.6;color:${C.subtext0};">If you did not request this code, you can ignore this email.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
  return { subject: VERIFICATION_SUBJECT, text, html };
}

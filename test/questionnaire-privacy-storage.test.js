import assert from 'node:assert/strict';
import test from 'node:test';
import { renderQuestionnaire } from '../src/questionnaire/ui.js';

function definition(questions, mode) {
  return {
    questionnaire_id: 'A'.repeat(24), revision: 1, status: 'open', title: 'Privacy layout', description: '',
    authentication_type: mode,
    questions,
    settings: { accent_color: '#6d5dfc', show_progress: true, submit_label: 'Send feedback', completion_message: 'Done.' },
  };
}
const text = { id: 'q1', type: 'short_text', title: 'Name a thing', required: false };
const upload = { id: 'q2', type: 'file_upload', title: 'Show it', required: false, settings: { formats: ['png'], max_files: 1, max_bytes: 1048576 } };

function section(html, open, close) {
  const start = html.indexOf(open);
  assert.ok(start >= 0, `missing ${open}`);
  return html.slice(start, html.indexOf(close, start));
}

test('submit area holds only the kicker and button', () => {
  const html = renderQuestionnaire(definition([text, upload], 'anonymous'), 'n');
  const panel = section(html, '<div class="submit-panel">', '</fieldset>');
  assert.match(panel, /Ready to send\?/);
  assert.match(panel, /id="submit-response"/);
  assert.doesNotMatch(panel, /<p\b/);
  assert.doesNotMatch(panel, /saved to the server|7 days|24 hours/);
});

test('privacy details sit in the sidebar, collapsed, with a native summary', () => {
  const html = renderQuestionnaire(definition([text], 'anonymous'), 'n');
  const nav = section(html, '<nav class="question-nav"', '</nav>');
  const details = section(nav, '<details class="privacy-details"', '</details>');
  assert.doesNotMatch(details, /\sopen[\s>]/);
  assert.match(details, /<summary>Privacy &amp; storage<\/summary>/);
  assert.doesNotMatch(html, /class="privacy-note"/);
});

test('each auth mode keeps its own autosave and identity facts', () => {
  const facts = {
    anonymous: [/This questionnaire is anonymous: no name or email is collected/, /not linked to a name or email/],
    self_report: [/confirm your name and email when you submit/, /name and email you enter at submission are stored/],
    email_verified: [/verify your email with a one-time code/, /verified email are stored with your answers/],
  };
  for (const [mode, patterns] of Object.entries(facts)) {
    const html = renderQuestionnaire(definition([text], mode), 'n');
    const details = section(html, '<details class="privacy-details"', '</details>');
    for (const p of patterns) assert.match(details, p, mode);
    assert.match(details, /saved to the server while you are online/);
  }
});

test('image privacy and retention copy appears only with uploads, inside the disclosure', () => {
  const withUpload = renderQuestionnaire(definition([upload], 'anonymous'), 'n');
  const details = section(withUpload, '<details class="privacy-details"', '</details>');
  assert.match(details, /private to the questionnaire owner/);
  assert.match(details, /camera and location metadata is removed/);
  assert.match(details, /7 days without activity/);
  assert.match(details, /removed images are deleted after 24 hours/);
  const without = renderQuestionnaire(definition([text], 'anonymous'), 'n');
  assert.doesNotMatch(without, /camera and location metadata/);
});

test('privacy disclosure is keyboard visible and responsive', () => {
  const html = renderQuestionnaire(definition([text], 'anonymous'), 'n');
  assert.match(html, /\.privacy-details > summary:focus-visible/);
  assert.match(html, /@media \(max-width: 800px\)[\s\S]*\.privacy-details/);
});

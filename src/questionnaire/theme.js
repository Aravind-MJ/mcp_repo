// Catppuccin Mocha: semantic surface steps, readable native controls, no assets.
export const QUESTIONNAIRE_CSS = String.raw`
:root {
  color-scheme: dark;
  --crust: #11111b;
  --mantle: #181825;
  --base: #1e1e2e;
  --surface0: #313244;
  --surface1: #45475a;
  --surface2: #585b70;
  --overlay1: #7f849c;
  --control-border: var(--overlay1);
  --text: #cdd6f4;
  --subtext1: #bac2de;
  --subtext0: #a6adc8;
  --mauve: #cba6f7;
  --lavender: #b4befe;
  --green: #a6e3a1;
  --peach: #fab387;
  --red: #f38ba8;
  --teal: #94e2d5;
  --focus: var(--lavender);
  --interactive: var(--mauve);
  --error: var(--red);
  --success: var(--green);
  --gutter: clamp(16px, 3vw, 40px);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 84px; }
body {
  margin: 0;
  background: var(--base);
  color: var(--text);
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: anywhere;
}
::selection { background: var(--mauve); color: var(--crust); }
button, input, textarea, select { font: inherit; }
button, a, input, textarea, select, summary { -webkit-tap-highlight-color: transparent; }
a { color: var(--lavender); }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
[hidden] { display: none !important; }
.sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.skip-link {
  position: fixed;
  z-index: 100;
  top: 10px;
  left: var(--gutter);
  transform: translateY(-160%);
  padding: 10px 16px;
  border-radius: 6px;
  background: var(--lavender);
  color: var(--crust);
}
.skip-link:focus { transform: none; }

/* Shared shell: the rail and editorial document start on the same baseline. */
.topbar {
  position: sticky;
  z-index: 20;
  top: 0;
  background: var(--mantle);
  border-bottom: 1px solid var(--surface0);
}
.topbar-inner {
  width: min(1220px, 100% - var(--gutter) * 2);
  min-height: 60px;
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.mark { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 650; letter-spacing: -.02em; flex-shrink: 0; }
.brand-symbol { width: 24px; height: 28px; color: var(--mauve); }
.brand-symbol .brand-detail { stroke: var(--custom-accent, var(--mauve)); }
.save-state { display: flex; align-items: center; gap: 8px; color: var(--subtext0); font-size: 12px; line-height: 1.4; }
.save-state::before { content: ""; flex: 0 0 6px; height: 6px; border-radius: 50%; background: var(--subtext0); }
.save-state[data-state="saving"]::before { background: var(--peach); animation: save-pulse 1.2s ease-in-out infinite; }
.save-state[data-state="saved"]::before { background: var(--green); }
.save-state[data-state="dirty"]::before { background: var(--peach); }
.save-state[data-state="error"]::before { background: var(--red); }
.layout {
  width: min(1220px, 100% - var(--gutter) * 2);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 254px minmax(0, 1fr);
  gap: clamp(36px, 5vw, 76px);
  padding: 48px 0 72px;
  align-items: start;
}
.form-column { min-width: 0; max-width: 800px; }
.document-heading { padding: 0 0 36px 48px; }
.eyebrow { margin: 0 0 16px; color: var(--mauve); font-size: 11px; font-weight: 650; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; max-width: 24ch; font-size: clamp(30px, 3.3vw, 46px); font-weight: 620; line-height: 1.14; letter-spacing: -.045em; text-wrap: balance; }
.document-description { display: block; margin: 18px 0 0; color: var(--subtext1); font-size: 16px; line-height: 1.75; white-space: pre-line; }
.introduction { margin: 0; }
.introduction > summary { list-style: none; cursor: pointer; }
.introduction > summary::-webkit-details-marker { display: none; }
.hero-description { max-width: none; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; }
.introduction[open] .hero-description { display: block; -webkit-line-clamp: unset; }
.description-toggle { display: inline-block; margin-top: 10px; padding: 2px 0; color: var(--lavender); font-size: 12px; }
.read-less, .introduction[open] .read-more { display: none; }
.introduction[open] .read-less { display: inline; }
.introduction[data-clamped="false"] > summary { cursor: default; }
.introduction[data-clamped="false"] .description-toggle { display: none; }
.document-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 22px; color: var(--subtext0); font-size: 12px; }
.document-meta span + span::before { content: "·"; margin-right: 18px; color: var(--surface2); }

/* A persistent outline, not a wizard: every active question stays in the document. */
.question-nav { position: sticky; top: 92px; min-width: 0; }
.outline-details { border: 1px solid var(--surface0); border-radius: 10px; background: var(--mantle); }
.outline-details > summary { padding: 18px; color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
.outline-details > summary::marker { color: var(--mauve); font-size: 11px; }
.outline-content { padding: 0 12px 12px; }
.outline-progress { padding: 0 6px 18px; }
.progress-track { height: 4px; overflow: hidden; border-radius: 99px; background: var(--surface0); }
.progress-track > span { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--mauve); transition: width 250ms ease; }
.progress-copy { margin-top: 10px; color: var(--subtext0); font-size: 12px; font-variant-numeric: tabular-nums; }
.outline-links { max-height: max(140px, calc(100dvh - 330px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--surface1) transparent; padding: 4px; }
.question-nav a {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 16px;
  align-items: start;
  gap: 8px;
  min-height: 44px;
  padding: 10px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--subtext0);
  font-size: 12px;
  line-height: 1.5;
  text-decoration: none;
  transition: background 150ms, color 150ms, border-color 150ms;
}
.outline-number { font: 11px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; }
.outline-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.question-nav a i { visibility: hidden; color: var(--green); font-style: normal; }
.question-nav a.complete i { visibility: visible; }
.question-nav a:hover { background: var(--base); color: var(--text); }
.question-nav a[aria-current="step"] { background: var(--surface0); color: var(--lavender); border-color: var(--surface1); }
.outline-footer { border-top: 1px solid var(--surface0); margin: 12px 6px 0; padding-top: 14px; }
.next-unanswered { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--base); color: var(--lavender); font-size: 12px; font-weight: 600; transition: background 150ms, border-color 150ms; }
.next-unanswered:hover:not(:disabled) { background: var(--surface0); border-color: var(--lavender); }
.next-unanswered:disabled { color: var(--subtext0); cursor: default; border-color: var(--surface0); }
.outline-note { margin: 14px 6px 0; color: var(--subtext0); font-size: 11px; line-height: 1.6; }

/* One continuous document, with indentation capped after the first follow-up. */
form > fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.question-card {
  scroll-margin-top: 90px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 0 20px;
  margin: 0;
  padding: 32px 0 38px;
  border-top: 1px solid var(--surface0);
}
.question-number { padding-top: 2px; color: var(--subtext0); font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; }
.question-card:focus-within > .question-number { color: var(--mauve); }
.question-body { min-width: 0; }
.question-metadata { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 10px; color: var(--subtext0); font-size: 11px; line-height: 1.4; }
.question-metadata .requirement { color: var(--peach); }
.question-metadata .follow-up-label { color: var(--teal); }
.question-heading { margin: 0 0 20px; }
.question-heading h2 { margin: 0; color: var(--text); font-size: clamp(19px, 2vw, 23px); font-weight: 580; line-height: 1.35; letter-spacing: -.025em; }
.question-heading p { margin: 9px 0 0; color: var(--subtext1); font-size: 14px; white-space: pre-line; }
.required { margin-left: 5px; color: var(--peach); }
.nested-questions { grid-column: 2; min-width: 0; display: grid; margin-top: 22px; padding: 0 18px; border: 1px solid var(--surface0); border-radius: 8px; background: var(--mantle); }
.nested-questions:not(:has(> .question-card:not([hidden]))) { display: none; }
.nested-question { grid-template-columns: minmax(0, 1fr); padding: 22px 0; border-top-color: var(--surface0); }
.nested-question:first-child { border-top: 0; }
.nested-question > .question-number { display: none; }
.nested-question .question-heading h2 { font-size: 17px; letter-spacing: -.015em; }
.nested-question .question-heading { margin-bottom: 14px; }
.nested-question .question-heading p { font-size: 13px; }
.nested-question .nested-questions { grid-column: 1; margin-top: 18px; padding: 0; border: 0; border-top: 1px dashed var(--surface1); border-radius: 0; }
.nested-question .nested-question { padding: 18px 0 0; }
.nested-question[data-revealed="true"] { animation: follow-up-in 220ms ease-out; }

/* Native inputs retain semantics; selection is explicit in both shape and color. */
.text-control { display: block; width: 100%; min-width: 0; min-height: 50px; padding: 12px 14px; border: 1px solid var(--control-border); border-radius: 7px; background: var(--mantle); color: var(--text); transition: border-color 160ms, background 160ms; }
.text-control::placeholder { color: var(--subtext0); opacity: 1; }
.text-control:hover { border-color: var(--subtext0); }
.text-control:focus { border-color: var(--lavender); outline: 2px solid var(--lavender); outline-offset: 3px; background: var(--base); }
.text-control.compact { max-width: 360px; }
textarea.text-control { min-height: 144px; resize: vertical; line-height: 1.7; }
.character-count { margin-top: 6px; color: var(--subtext0); font-size: 11px; text-align: right; }
.character-count:empty { display: none; }
.select-wrap { position: relative; max-width: 480px; }
.select-wrap select { appearance: none; padding-right: 40px; }
.select-wrap > span { position: absolute; right: 16px; top: 12px; color: var(--lavender); pointer-events: none; }
.option-list { display: grid; gap: 8px; }
.option-card { position: relative; display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 13px; min-height: 56px; padding: 14px 16px; border: 1px solid var(--control-border); border-radius: 7px; background: var(--mantle); cursor: pointer; transition: border-color 160ms, background 160ms; }
.option-card:hover { border-color: var(--subtext0); background: var(--surface0); }
.option-card:has(input:checked) { border-color: var(--mauve); background: var(--surface0); }
.option-card input, .segmented input, .consent-card input, .rating input, .scale-options input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.option-indicator { display: grid; place-items: center; width: 19px; height: 19px; border: 1.5px solid var(--subtext0); border-radius: 50%; background: var(--base); transition: border-color 160ms, background 160ms; }
input[type="checkbox"] + .option-indicator { border-radius: 4px; }
.option-card input:checked + .option-indicator { border-color: var(--mauve); background: var(--mauve); }
.option-card input:checked + .option-indicator::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--crust); }
.option-card input[type="checkbox"]:checked + .option-indicator::after { content: "✓"; width: auto; height: auto; background: none; color: var(--crust); font-size: 13px; font-weight: 750; }
.option-copy { min-width: 0; }
.option-copy strong { display: block; color: var(--text); font-size: 14px; font-weight: 550; line-height: 1.5; }
.option-copy small { display: block; margin-top: 3px; color: var(--subtext1); font-size: 12px; line-height: 1.6; }
.option-card:has(input:focus-visible), .consent-card:has(input:focus-visible),
.segmented label:has(input:focus-visible) span, .rating label:has(input:focus-visible) span[aria-hidden],
.scale-options label:has(input:focus-visible) span { outline: 2px solid var(--focus); outline-offset: 4px; }
.segmented { display: grid; grid-template-columns: repeat(2, minmax(0, 160px)); gap: 8px; }
.segmented label, .rating label, .scale-options label, .consent-card { position: relative; }
.segmented span { display: block; padding: 12px; text-align: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--mantle); cursor: pointer; font-weight: 550; transition: background 160ms, color 160ms; }
.segmented input:checked + span, .scale-options input:checked + span { border-color: var(--mauve); background: var(--mauve); color: var(--crust); }
.consent-card { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--control-border); border-radius: 7px; background: var(--mantle); cursor: pointer; font-size: 14px; }
.consent-card:has(input:checked) { background: var(--surface0); border-color: var(--mauve); }
.checkmark { display: grid; place-items: center; flex: 0 0 21px; height: 21px; border: 1px solid var(--subtext0); border-radius: 4px; color: transparent; }
.consent-card input:checked + .checkmark { border-color: var(--mauve); background: var(--mauve); color: var(--crust); }
.rating { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
.rating span[aria-hidden] { display: grid; place-items: center; width: 44px; height: 46px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--mantle); color: var(--subtext0); cursor: pointer; font-size: 22px; transition: color 160ms, background 160ms; }
.rating label:hover span[aria-hidden], .rating label:has(~ label:hover) span[aria-hidden],
.rating label:has(input:checked) span[aria-hidden], .rating label:has(~ label input:checked) span[aria-hidden] { color: var(--mauve); border-color: var(--mauve); background: var(--surface0); }
.rating label:has(input:checked) span[aria-hidden] { box-shadow: inset 0 -3px var(--mauve); }
.scale-wrap { min-width: 0; }
.scale-options { display: flex; flex-wrap: wrap; gap: 6px; }
.scale-options label { flex: 1 0 40px; max-width: 64px; }
.scale-options span { display: grid; place-items: center; min-height: 44px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--mantle); cursor: pointer; font-size: 14px; transition: background 160ms, color 160ms; }
.scale-labels { display: flex; justify-content: space-between; gap: 18px; margin-top: 10px; color: var(--subtext0); font-size: 12px; }
.scale-labels span:last-child { text-align: right; }
.ranking .field-hint { margin-top: 0; }
.ranking ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ranking li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--control-border); border-radius: 7px; background: var(--mantle); }
.rank-number { color: var(--mauve); font: 12px ui-monospace, monospace; }
.rank-label { font-size: 13px; }
.rank-actions { display: flex; gap: 4px; }
.rank-actions button { width: 36px; height: 40px; border: 1px solid var(--control-border); border-radius: 5px; background: var(--base); color: var(--text); }
.rank-actions button:hover:not(:disabled) { border-color: var(--mauve); color: var(--mauve); }
.rank-actions button:disabled { border-color: var(--surface0); color: var(--subtext0); background: var(--mantle); cursor: not-allowed; }
.matrix-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; border: 1px solid var(--surface1); border-radius: 7px; scrollbar-width: thin; scrollbar-color: var(--surface2) var(--mantle); }
.matrix { width: 100%; min-width: 480px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.matrix th, .matrix td { padding: 12px; border-bottom: 1px solid var(--surface0); text-align: center; }
.matrix th:first-child { position: sticky; left: 0; z-index: 1; min-width: 140px; max-width: 220px; text-align: left; background: var(--mantle); }
.matrix thead th { background: var(--mantle); color: var(--subtext1); font-size: 12px; font-weight: 500; }
.matrix tbody th { font-weight: 500; }
.matrix tbody tr:last-child > * { border-bottom: 0; }
.matrix td:has(input:checked) { background: var(--surface0); }
.matrix label { position: relative; display: grid; place-items: center; min-width: 36px; min-height: 36px; cursor: pointer; }
.matrix input { width: 20px; height: 20px; accent-color: var(--mauve); }

/* Validation and terminal states stay legible without color alone. */
.field-hint { color: var(--subtext0); font-size: 12px; }
.field-error { margin: 8px 0 0; color: var(--red); font-size: 13px; }
.field-error:empty, .selection-hint:empty { display: none; }
.closed-banner, .form-alert { margin: 0 0 24px; padding: 16px 18px; border: 1px solid var(--red); border-radius: 7px; background: var(--mantle); color: var(--red); font-size: 14px; }
.closed-banner { border-color: var(--surface2); color: var(--subtext1); }
[aria-invalid="true"] > .question-body > .question-heading h2 { color: var(--red); }
.submit-panel { margin: 12px 0 0 48px; padding-top: 30px; border-top: 1px solid var(--surface0); }
.submit-kicker { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text); }
.submit-panel p { margin: 0 0 20px; max-width: 58ch; color: var(--subtext0); font-size: 12px; }
.respondent-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 0 0 22px; }
.respondent-fields label { min-width: 0; }
.respondent-fields label > span { display: block; margin-bottom: 7px; color: var(--subtext1); font-size: 12px; font-weight: 600; }
.respondent-fields b { color: var(--peach); }
.submit-button { display: inline-flex; align-items: center; justify-content: center; gap: 20px; min-height: 50px; max-width: 100%; padding: 12px 22px; border: 1px solid var(--mauve); border-radius: 7px; background: var(--mauve); color: var(--crust); font-size: 14px; font-weight: 650; transition: background 160ms, border-color 160ms; }
.submit-button:hover { background: var(--lavender); border-color: var(--lavender); }
.submit-button:disabled { background: var(--surface0); color: var(--subtext1); border-color: var(--surface2); cursor: wait; }
.privacy-note { margin: 24px 0 0 48px; color: var(--subtext0); font-size: 11px; line-height: 1.7; }
.completion { width: min(620px, 100% - var(--gutter) * 2); margin: 12vh auto; padding: clamp(24px, 5vw, 48px); border: 1px solid var(--surface1); border-radius: 12px; background: var(--mantle); }
.completion-mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 28px; border: 1px solid var(--green); border-radius: 50%; color: var(--green); font-size: 22px; }
.completion .eyebrow { color: var(--green); }
.completion h2 { margin: 0; font-size: 36px; font-weight: 600; line-height: 1.2; letter-spacing: -.04em; }
.completion > p:last-child { margin: 18px 0 0; color: var(--subtext1); white-space: pre-line; }
@keyframes save-pulse { 50% { transform: scale(.65); } }
@keyframes follow-up-in { from { transform: translateY(5px); } to { transform: translateY(0); } }

@media (max-width: 800px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 28px; padding-top: 24px; }
  .question-nav { position: static; }
  .outline-details > summary { padding: 13px 16px; }
  .outline-links { max-height: 240px; }
  .outline-note { display: none; }
  .outline-footer { margin-top: 8px; }
  .document-heading { padding-bottom: 28px; }
  h1 { font-size: clamp(29px, 6vw, 40px); }
  .question-card { padding-top: 28px; padding-bottom: 32px; }
}
@media (max-width: 480px) {
  .topbar-inner { min-height: 58px; gap: 12px; }
  .mark { font-size: 12px; gap: 8px; }
  .save-state { max-width: 145px; font-size: 11px; }
  .brand-symbol { width: 20px; height: 24px; }
  .document-heading { padding-left: 0; }
  .document-meta { gap: 6px 12px; }
  .document-meta span + span::before { margin-right: 12px; }
  .question-card { grid-template-columns: 22px minmax(0, 1fr); column-gap: 10px; }
  .nested-questions { grid-column: 1 / -1; padding: 0 12px; margin-top: 20px; }
  .nested-question { grid-template-columns: minmax(0, 1fr); }
  .nested-question .nested-questions { grid-column: 1; }
  .option-card { padding: 13px 12px; gap: 10px; }
  .submit-panel, .privacy-note { margin-left: 0; }
  .respondent-fields { grid-template-columns: 1fr; }
  .submit-button { width: 100%; }
  .rank-actions { gap: 3px; }
  .rank-actions button { width: 32px; }
  .ranking li { grid-template-columns: 15px minmax(0, 1fr) auto; gap: 6px; padding: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
`;

const SHARED_STYLES = `
:root {
  color-scheme: dark;
  --canvas: #0b0c0f;
  --surface: #111216;
  --surface-2: #15171c;
  --text: #f3f0e9;
  --muted: #a4a3a0;
  --quiet: #7b7c81;
  --line: #32343b;
  --accent: #aeb9ff;
  --accent-soft: #1c2133;
  --warning: #f1bd78;
  --warning-soft: #2a2015;
  --shell: 76rem;
}
* { box-sizing: border-box; }
html { background: var(--canvas); }
body {
  min-width: 20rem;
  margin: 0;
  background: var(--canvas);
  color: var(--text);
  font: 400 1rem/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
.skip-link {
  position: fixed;
  z-index: 10;
  top: .75rem;
  left: .75rem;
  padding: .75rem 1rem;
  background: var(--text);
  color: var(--canvas);
  font-weight: 750;
  transform: translateY(-180%);
}
.skip-link:focus { transform: translateY(0); }
.shell { width: min(var(--shell), calc(100% - 3rem)); margin-inline: auto; }
.site-header {
  display: flex;
  min-height: 6.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  border-bottom: 1px solid var(--line);
}
.hub-link, .module-id { display: inline-flex; align-items: center; text-decoration: none; }
.hub-link {
  min-height: 2.75rem;
  gap: .65rem;
  color: var(--muted);
  font: 700 .74rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.hub-link::before { color: var(--accent); content: "←"; font-size: 1rem; }
.module-id { gap: .75rem; }
.module-id img { width: 2.75rem; height: 2.75rem; border-radius: .7rem; }
.module-id span {
  color: var(--muted);
  font: 700 .7rem/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .11em;
  text-align: right;
  text-transform: uppercase;
}
main { padding-block: clamp(4.5rem, 9vw, 8rem) 5rem; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(18rem, .72fr);
  gap: clamp(3rem, 8vw, 8rem);
  align-items: start;
  padding-bottom: clamp(4rem, 8vw, 7rem);
}
.hero > * { min-width: 0; }
.eyebrow, .section-label, .fact-label {
  color: var(--accent);
  font: 750 .7rem/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.eyebrow { margin: 0 0 1.25rem; }
h1 {
  max-width: 11ch;
  margin: 0;
  font: 540 clamp(3.6rem, 8.8vw, 7.7rem)/.86 ui-serif, Georgia, Cambria, "Times New Roman", serif;
  letter-spacing: -.066em;
  text-wrap: balance;
}
.lede {
  max-width: 45rem;
  margin: 2rem 0 0;
  color: #c9c6bf;
  font-size: clamp(1.05rem, 1.9vw, 1.35rem);
  line-height: 1.55;
}
.hero-aside { min-width: 0; }
.status {
  display: inline-flex;
  align-items: center;
  gap: .55rem;
  margin-bottom: 1.5rem;
  color: var(--accent);
  font: 750 .7rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.status::before { width: .5rem; height: .5rem; border-radius: 50%; background: currentColor; content: ""; }
.endpoint {
  padding-block: 1rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.endpoint span { display: block; margin-bottom: .65rem; color: var(--quiet); font: 700 .67rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; }
.endpoint code { display: block; min-width: 0; color: var(--text); font: 650 .85rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.endpoint code strong { margin-right: .65rem; color: var(--accent); font-size: .7rem; letter-spacing: .08em; }
.endpoint + .endpoint { border-top: 0; }
.dashboard-link { display: flex; min-width: 0; min-height: 1.5rem; align-items: center; justify-content: space-between; gap: 1rem; color: var(--text); font: 650 .8rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; text-decoration-color: transparent; text-underline-offset: .28rem; }
.dashboard-link::after { flex: none; color: var(--accent); content: "↗"; }
.dashboard-link:hover { text-decoration-color: var(--accent); }
.actions { display: grid; gap: .6rem; margin-top: 1.5rem; }
.action {
  display: flex;
  min-height: 3rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: .7rem 1rem;
  border: 1px solid var(--line);
  color: var(--text);
  font-size: .86rem;
  font-weight: 720;
  text-decoration: none;
}
.action::after { color: var(--accent); content: "↗"; }
.action--primary { border-color: var(--accent); background: var(--accent); color: #0b0c0f; }
.action--primary::after { color: inherit; }
.action:hover { background: var(--surface-2); }
.action--primary:hover { background: var(--text); border-color: var(--text); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: .28rem; }
.fact-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.fact { min-width: 0; padding: 1.5rem 1.75rem; border-right: 1px solid var(--line); }
.fact:first-child { padding-left: 0; }
.fact:last-child { border-right: 0; }
.fact-label { display: block; margin-bottom: .45rem; color: var(--quiet); }
.fact-value { color: var(--text); font: 600 1rem/1.35 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.section {
  display: grid;
  grid-template-columns: minmax(9rem, .35fr) minmax(0, 1fr);
  gap: clamp(2rem, 7vw, 7rem);
  padding-block: clamp(3.5rem, 7vw, 6rem);
  border-bottom: 1px solid var(--line);
}
.section-label { margin: .3rem 0 0; }
.section-body { min-width: 0; }
.section h2 {
  max-width: 16ch;
  margin: 0;
  font: 560 clamp(2.1rem, 4.5vw, 4rem)/.98 ui-serif, Georgia, Cambria, "Times New Roman", serif;
  letter-spacing: -.048em;
  text-wrap: balance;
}
.flow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 2.5rem 0 0;
  padding: 0;
  border-top: 1px solid var(--line);
  list-style: none;
  counter-reset: flow;
}
.flow li { min-width: 0; padding: 1.4rem 1.5rem 0 0; counter-increment: flow; }
.flow li + li { padding-left: 1.5rem; border-left: 1px solid var(--line); }
.flow li::before { display: block; margin-bottom: 2.75rem; color: var(--accent); font: 750 .7rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; content: "0" counter(flow); }
.flow h3 { margin: 0 0 .55rem; font-size: 1rem; letter-spacing: -.015em; }
.flow p { margin: 0; color: var(--muted); font-size: .88rem; line-height: 1.6; }
.trust-note {
  margin-top: 2.5rem;
  padding: 1.35rem 1.5rem;
  border-left: 2px solid var(--accent);
  background: var(--accent-soft);
  color: #cac8c2;
}
.trust-note strong { color: var(--accent); }
.trust-note p { margin: 0; }
.trust-note p + p { margin-top: .7rem; }
.hero-aside .trust-note { margin-top: 1.5rem; }
.trust-note--warning { border-color: var(--warning); background: var(--warning-soft); }
.trust-note--warning strong { color: var(--warning); }
.tools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 2.5rem 0 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
.tool { min-width: 0; padding: 1.3rem 1.5rem 1.3rem 0; border-bottom: 1px solid var(--line); }
.tool:nth-child(even) { padding-left: 1.5rem; border-left: 1px solid var(--line); }
.tool code { color: var(--accent); font: 700 .8rem/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.tool p { margin: .45rem 0 0; color: var(--muted); font-size: .84rem; }
.tool-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2.5rem; border-top: 1px solid var(--line); }
.tool-group { min-width: 0; padding: 1.6rem 1.5rem 0 0; }
.tool-group:nth-child(even) { padding-left: 1.5rem; border-left: 1px solid var(--line); }
.tool-group h3 { margin: 0; color: var(--text); font-size: .82rem; letter-spacing: .08em; text-transform: uppercase; }
.tool-group .tools { grid-template-columns: 1fr; margin-top: 1rem; }
.tool-group .tool, .tool-group .tool:nth-child(even) { padding: 1rem 0; border-left: 0; }
.site-footer { display: flex; justify-content: space-between; gap: 2rem; padding: 2rem 0 3.25rem; color: var(--quiet); font: 650 .69rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .09em; text-transform: uppercase; }
.site-footer p { margin: 0; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
@media (max-width: 52rem) {
  .hero { grid-template-columns: 1fr; align-items: start; }
  .hero-aside { max-width: 32rem; }
  .section { grid-template-columns: 1fr; gap: 1.5rem; }
}
@media (max-width: 38rem) {
  .shell { width: calc(100% - 2rem); }
  .site-header { min-height: 5.5rem; }
  .module-id span { max-width: 6.5rem; }
  main { padding-top: 3.75rem; }
  h1 { font-size: clamp(3.35rem, 18vw, 5rem); }
  html[data-module="questionnaire"] h1 { font-size: clamp(3rem, 14vw, 4.5rem); }
  .lede { margin-top: 1.4rem; }
  .fact-row, .flow, .tools { grid-template-columns: 1fr; }
  .fact { padding: 1rem 0; border-right: 0; border-bottom: 1px solid var(--line); }
  .fact:last-child { border-bottom: 0; }
  .flow li, .flow li + li { padding: 1.2rem 0; border-left: 0; border-bottom: 1px solid var(--line); }
  .flow li::before { margin-bottom: .65rem; }
  .flow li:last-child { border-bottom: 0; }
  .tool, .tool:nth-child(even) { padding: 1.15rem 0; border-left: 0; }
  .tool-groups { grid-template-columns: 1fr; }
  .tool-group, .tool-group:nth-child(even) { padding: 1.35rem 0 0; border-left: 0; }
  .site-footer { flex-direction: column; gap: .45rem; }
}
`;

const artifactTools = `
  <li class="tool"><code>get_attachment_upload_url</code><p>Get the authenticated binary upload endpoint and existing attachment references.</p></li>
  <li class="tool"><code>publish_html</code><p>Publish a complete self-contained HTML document.</p></li>
  <li class="tool"><code>update_artifact</code><p>Create a new version while preserving the artifact identity.</p></li>
  <li class="tool"><code>get_signed_url</code><p>Mint a fresh expiring link for the latest artifact or one version.</p></li>
  <li class="tool"><code>list_artifacts</code><p>List recent metadata without returning HTML source.</p></li>
  <li class="tool"><code>delete_artifact</code><p>Permanently remove an artifact and its version history.</p></li>`;

const questionnaireTools = [
  `<li class="tool"><code>create_questionnaire</code><p>Create a typed questionnaire and its first revision.</p></li>`,
  `<li class="tool"><code>update_questionnaire</code><p>Create a new immutable revision without changing older links.</p></li>`,
  `<li class="tool"><code>get_questionnaire</code><p>Retrieve one definition and its response counts.</p></li>`,
  `<li class="tool"><code>list_questionnaires</code><p>List current definitions with status and response counts.</p></li>`,
  `<li class="tool"><code>get_questionnaire_signed_url</code><p>Mint a latest-revision or exact-revision answer link.</p></li>`,
  `<li class="tool"><code>submit_questionnaire_response</code><p>Submit complete answers with respondent name and email directly through MCP.</p></li>`,
  `<li class="tool"><code>set_questionnaire_status</code><p>Open or close response collection.</p></li>`,
  `<li class="tool"><code>delete_questionnaire</code><p>Delete every revision and response for one questionnaire.</p></li>`,
  `<li class="tool"><code>list_questionnaire_responses</code><p>List bounded response metadata without answer bodies.</p></li>`,
  `<li class="tool"><code>get_questionnaire_response</code><p>Retrieve one stored response and its answers.</p></li>`,
  `<li class="tool"><code>delete_questionnaire_response</code><p>Permanently remove one draft or submitted response.</p></li>`,
];

export const ARTIFACT_LANDING_HTML = `<!doctype html>
<html lang="en" data-module="artifact">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0b0c0f">
  <meta name="description" content="Publish, version, and share self-contained HTML through an authenticated MCP.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>HTML Artifact Publisher · Personal MCP Hub</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="shell">
    <header class="site-header">
      <a class="hub-link" href="/">All MCP services</a>
      <span class="module-id"><img src="/logo.svg" width="44" height="44" alt=""><span>Module 01<br>Publishing</span></span>
    </header>
    <main id="main-content">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Personal MCP Hub · Artifact</p>
          <h1 id="page-title">HTML Artifact Publisher</h1>
          <p class="lede">Turn a self-contained HTML document into a shareable, versioned artifact—without exposing a public upload surface or artifact index.</p>
        </div>
        <aside class="hero-aside" aria-label="Connection details">
          <span class="status">Bearer authentication required</span>
          <div class="endpoint"><span>Streamable HTTP endpoint</span><code><strong>POST</strong>https://mcp.aravindmj.in/artifact/mcp</code></div>
          <div class="endpoint"><span>Dashboard · HTTP auth</span><a class="dashboard-link" href="/artifacts">https://mcp.aravindmj.in/artifacts</a></div>
          <div class="trust-note" role="note" aria-labelledby="artifact-trust-title">
            <p id="artifact-trust-title"><strong>Trust boundary:</strong> management and publishing require the shared bearer credential. Keep it out of prompts, logs, source control, shell history, and published HTML.</p>
            <p>Anyone with an unexpired signed URL can view that artifact. Link expiry does not delete stored data; deletion is permanent.</p>
          </div>
          <nav class="actions" aria-label="Artifact Publisher resources">
            <a class="action action--primary" href="/artifact/README.md">Read installation guide</a>
            <a class="action" href="/artifact/SKILL.md">View companion skill</a>
          </nav>
        </aside>
      </section>

      <div class="fact-row" role="list" aria-label="Service facts">
        <div class="fact" role="listitem"><span class="fact-label">Tool set</span><span class="fact-value">6 tools</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Recommended name</span><span class="fact-value">aravind_html_publisher</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Default link lifetime</span><span class="fact-value">One week</span></div>
      </div>

      <section class="section" aria-labelledby="artifact-flow-title">
        <p class="section-label">How it works</p>
        <div class="section-body">
          <h2 id="artifact-flow-title">Publish once. Revise without losing the thread.</h2>
          <ol class="flow">
            <li><h3>Publish</h3><p>Send complete HTML through the authenticated MCP and receive an opaque artifact identity.</p></li>
            <li><h3>Revise</h3><p>Update the same artifact. The latest URL follows the current version while prior version URLs stay immutable.</p></li>
            <li><h3>Share</h3><p>Create a signed link valid from 60 seconds to one year. Anyone holding an unexpired link can view it.</p></li>
          </ol>
          <div class="trust-note"><p><strong>Rendered safely:</strong> hosted pages require a valid signed URL or owner Basic Auth and execute inside a restrictive CSP sandbox.</p><p>Never publish secrets or private data.</p></div>
        </div>
      </section>

      <section class="section" aria-labelledby="artifact-tools-title">
        <p class="section-label">Tool registry</p>
        <div class="section-body">
          <h2 id="artifact-tools-title">A compact publishing lifecycle.</h2>
          <ul class="tools">${artifactTools}</ul>
        </div>
      </section>
    </main>
    <footer class="site-footer"><p>Personal MCP Hub</p><p>mcp.aravindmj.in/artifact</p></footer>
  </div>
</body>
</html>`;

export const QUESTIONNAIRE_LANDING_HTML = `<!doctype html>
<html lang="en" data-module="questionnaire">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0b0c0f">
  <meta name="description" content="Create revisioned questionnaires, share signed answer links, and collect responses through an MCP.">
  <link rel="icon" href="/questionnaire.svg?v=20260911-modules1" type="image/svg+xml">
  <title>Questionnaire Collector · Personal MCP Hub</title>
  <style>${SHARED_STYLES}:root{--accent:#9ed8b1;--accent-soft:#14221a}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="shell">
    <header class="site-header">
      <a class="hub-link" href="/">All MCP services</a>
      <span class="module-id"><img src="/questionnaire.svg?v=20260911-modules1" width="44" height="44" alt=""><span>Module 02<br>Collection</span></span>
    </header>
    <main id="main-content">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Personal MCP Hub · Questionnaire</p>
          <h1 id="page-title">Questionnaire Collector</h1>
          <p class="lede">Design revisioned questionnaires, issue signed answer forms, and inspect collected responses through one MCP.</p>
        </div>
        <aside class="hero-aside" aria-label="Connection details">
          <span class="status">Bearer authentication required</span>
          <div class="endpoint"><span>Streamable HTTP endpoint</span><code><strong>POST</strong>https://mcp.aravindmj.in/questionnaire/mcp</code></div>
          <div class="endpoint"><span>Dashboard · HTTP auth</span><a class="dashboard-link" href="/questionnaires">https://mcp.aravindmj.in/questionnaires</a></div>
          <nav class="actions" aria-label="Questionnaire Collector resources">
            <a class="action action--primary" href="/questionnaire/README.md">Read installation guide</a>
            <a class="action" href="/questionnaire/SKILL.md">View companion skill</a>
          </nav>
        </aside>
      </section>

      <div class="fact-row" role="list" aria-label="Service facts">
        <div class="fact" role="listitem"><span class="fact-label">Tool set</span><span class="fact-value">11 tools</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Recommended name</span><span class="fact-value">aravind_questionnaires</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Answer access</span><span class="fact-value">Expiring signed links</span></div>
      </div>

      <section class="section" aria-labelledby="questionnaire-flow-title">
        <p class="section-label">How it works</p>
        <div class="section-body">
          <h2 id="questionnaire-flow-title">Shape the form. Keep every revision legible.</h2>
          <ol class="flow">
            <li><h3>Define</h3><p>Create typed questions, optional conditional branches, progress behavior, and completion copy.</p></li>
            <li><h3>Distribute</h3><p>Share a latest-revision link or pin an immutable revision. Every answer form requires an unexpired signature.</p></li>
            <li><h3>Collect</h3><p>Drafts autosave anonymously; final submissions require name and email, validate strictly, and remain available to management tools.</p></li>
          </ol>
          <div class="trust-note"><p><strong>Data lifecycle:</strong> closing a questionnaire prevents new saves but retains stored responses. Signed-link expiry also does not delete responses; explicit deletion is permanent.</p></div>
        </div>
      </section>

      <section class="section" aria-labelledby="questionnaire-tools-title">
        <p class="section-label">Tool registry</p>
        <div class="section-body">
          <h2 id="questionnaire-tools-title">Definition, distribution, and response management.</h2>
          <div class="tool-groups">
            <section class="tool-group" aria-labelledby="questionnaire-define-title">
              <h3 id="questionnaire-define-title">Define</h3>
              <ul class="tools">${questionnaireTools.slice(0, 4).join("")}</ul>
            </section>
            <section class="tool-group" aria-labelledby="questionnaire-distribute-title">
              <h3 id="questionnaire-distribute-title">Distribute &amp; operate</h3>
              <ul class="tools">${questionnaireTools.slice(4, 6).join("")}</ul>
            </section>
            <section class="tool-group" aria-labelledby="questionnaire-review-title">
              <h3 id="questionnaire-review-title">Review responses</h3>
              <ul class="tools">${questionnaireTools.slice(7, 9).join("")}</ul>
            </section>
            <section class="tool-group" aria-labelledby="questionnaire-delete-title">
              <h3 id="questionnaire-delete-title">Permanent deletion</h3>
              <ul class="tools">${questionnaireTools.slice(9).join("")}${questionnaireTools.slice(6, 7).join("")}</ul>
            </section>
          </div>
        </div>
      </section>
    </main>
    <footer class="site-footer"><p>Personal MCP Hub</p><p>mcp.aravindmj.in/questionnaire</p></footer>
  </div>
</body>
</html>`;

const jevTools = `<li class="tool"><code>make_decisions</code><p>Evaluate mixed yes/no, choice, and ordered-score questions against one shared state.</p></li>`;

export const JEV_LANDING_HTML = `<!doctype html>
<html lang="en" data-module="jev">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0b0c0f">
  <meta name="description" content="Make fast typed semantic decisions with Jev through an authenticated MCP.">
  <link rel="icon" href="/jev.svg" type="image/svg+xml">
  <title>Jev Structured Decisions · Personal MCP Hub</title>
  <style>${SHARED_STYLES}:root{--accent:#e7a8ff;--accent-soft:#25172b}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="shell">
    <header class="site-header">
      <a class="hub-link" href="/">All MCP services</a>
      <span class="module-id"><img src="/jev.svg" width="44" height="44" alt=""><span>Module 03<br>Decisions</span></span>
    </header>
    <main id="main-content">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Personal MCP Hub · Jev</p>
          <h1 id="page-title">Jev Structured Decisions</h1>
          <p class="lede">Turn text or structured state into bounded choices, ordered scores, and yes probabilities through TypeSafe Jev on OpenRouter.</p>
        </div>
        <aside class="hero-aside" aria-label="Connection details">
          <span class="status">Bearer authentication required</span>
          <div class="endpoint"><span>Streamable HTTP endpoint</span><code><strong>POST</strong>https://mcp.aravindmj.in/jev/mcp</code></div>
          <div class="endpoint"><span>Dashboard · HTTP auth</span><a class="dashboard-link" href="/jev/logs">https://mcp.aravindmj.in/jev/logs</a></div>
          <div class="trust-note trust-note--warning" role="note">
            <p><strong>Two trust boundaries:</strong> MCP clients use the hub's shared bearer credential. The upstream OpenRouter key stays on the server and is never returned to clients.</p>
            <p>State is processed by OpenRouter and TypeSafe. Type-safe outputs can still be wrong.</p>
          </div>
          <nav class="actions" aria-label="Jev Decisions resources">
            <a class="action action--primary" href="/jev/README.md">Read installation guide</a>
            <a class="action" href="/jev/SKILL.md">View companion skill</a>
          </nav>
        </aside>
      </section>

      <div class="fact-row" role="list" aria-label="Service facts">
        <div class="fact" role="listitem"><span class="fact-label">Tool set</span><span class="fact-value">1 tool</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Recommended name</span><span class="fact-value">aravind_jev_decisions</span></div>
        <div class="fact" role="listitem"><span class="fact-label">Default model</span><span class="fact-value">typesafe/jev-1.13</span></div>
      </div>

      <section class="section" aria-labelledby="jev-flow-title">
        <p class="section-label">How it works</p>
        <div class="section-body">
          <h2 id="jev-flow-title">Define the paths. Let Jev weigh them.</h2>
          <ol class="flow">
            <li><h3>State</h3><p>Provide the smallest relevant text, object, or array for the decision.</p></li>
            <li><h3>Questions</h3><p>Declare independent noul, choice, or score judgments with concrete criteria.</p></li>
            <li><h3>Policy</h3><p>Use distributions and validated thresholds in code; escalate uncertain or costly cases.</p></li>
          </ol>
          <div class="trust-note"><p><strong>Bounded, not infallible:</strong> Jev cannot emit an undeclared choice, but it can confidently choose the wrong declared option.</p></div>
        </div>
      </section>

      <section class="section" aria-labelledby="jev-tools-title">
        <p class="section-label">Tool registry</p>
        <div class="section-body">
          <h2 id="jev-tools-title">One request, many independent judgments.</h2>
          <ul class="tools">${jevTools}</ul>
        </div>
      </section>
    </main>
    <footer class="site-footer"><p>Personal MCP Hub</p><p>mcp.aravindmj.in/jev</p></footer>
  </div>
</body>
</html>`;

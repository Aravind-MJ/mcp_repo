export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0b0c0f">
  <meta name="description" content="Personal MCP services for publishing HTML artifacts and collecting questionnaire responses.">
  <link rel="icon" href="/hub.svg" type="image/svg+xml">
  <title>Personal MCP Hub · Aravind M J</title>
  <style>
    :root {
      color-scheme: dark;
      --canvas: #0b0c0f;
      --surface: #111216;
      --surface-hover: #15161b;
      --text: #f3f0e9;
      --muted: #a4a3a0;
      --quiet: #7b7c81;
      --line: #32343b;
      --artifact: #aeb9ff;
      --questionnaire: #9ed8b1;
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
      padding: .7rem 1rem;
      background: var(--text);
      color: var(--canvas);
      font-weight: 700;
      transform: translateY(-180%);
    }

    .skip-link:focus { transform: translateY(0); }

    .shell {
      width: min(var(--shell), calc(100% - 3rem));
      margin-inline: auto;
    }

    .site-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2rem;
      min-height: 6.75rem;
      border-bottom: 1px solid var(--line);
    }

    .identity {
      display: flex;
      align-items: center;
      gap: .9rem;
      text-decoration: none;
    }

    .identity img {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: .72rem;
    }

    .identity-copy { display: grid; line-height: 1.2; }
    .identity-copy strong { font-size: .92rem; letter-spacing: -.01em; }
    .identity-copy span { margin-top: .18rem; color: var(--muted); font-size: .75rem; letter-spacing: .09em; text-transform: uppercase; }

    .registry-count {
      margin: 0;
      color: var(--muted);
      font: 650 .72rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    main { padding-block: clamp(4.5rem, 10vw, 8.5rem) 5rem; }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(17rem, 25rem);
      align-items: end;
      gap: clamp(2.5rem, 7vw, 7rem);
      padding-bottom: clamp(4rem, 9vw, 7rem);
    }

    .eyebrow {
      margin: 0 0 1.35rem;
      color: var(--muted);
      font: 700 .73rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 12ch;
      margin: 0;
      font: 500 clamp(3.5rem, 8.7vw, 7.6rem)/.89 ui-serif, Georgia, Cambria, "Times New Roman", serif;
      letter-spacing: -.067em;
      text-wrap: balance;
    }

    .hero-intro {
      margin: 0 0 .45rem;
      color: #c7c5c0;
      font-size: clamp(1.05rem, 1.8vw, 1.28rem);
      line-height: 1.55;
    }

    .registry {
      border-top: 1px solid var(--line);
    }

    .module {
      --accent: var(--artifact);
      display: grid;
      grid-template-columns: 5.5rem minmax(0, 1fr) minmax(15rem, 20rem);
      gap: clamp(1.5rem, 4vw, 4rem);
      padding: clamp(2.25rem, 5vw, 4rem) 0;
      border-bottom: 1px solid var(--line);
      background: var(--canvas);
    }

    .module--questionnaire { --accent: var(--questionnaire); }

    .module-index {
      margin: .35rem 0 0;
      color: var(--accent);
      font: 700 .78rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .12em;
    }

    .module-copy { min-width: 0; }

    .module-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: .6rem 1rem;
      margin-bottom: 1.25rem;
    }

    .access {
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      color: var(--accent);
      font: 700 .69rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .11em;
      text-transform: uppercase;
    }

    .access::before {
      width: .45rem;
      height: .45rem;
      border-radius: 50%;
      background: currentColor;
      content: "";
    }

    .tool-count {
      color: var(--quiet);
      font: 650 .69rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .1em;
      text-transform: uppercase;
    }

    h2 {
      max-width: 14ch;
      margin: 0;
      font: 600 clamp(2rem, 4vw, 3.5rem)/1 ui-serif, Georgia, Cambria, "Times New Roman", serif;
      letter-spacing: -.045em;
      text-wrap: balance;
    }

    .module-description {
      max-width: 37rem;
      margin: 1.2rem 0 0;
      color: var(--muted);
      font-size: 1.02rem;
    }

    .module-technical {
      display: flex;
      min-width: 0;
      flex-direction: column;
      justify-content: space-between;
      gap: 2rem;
      padding-top: .15rem;
    }

    .endpoint-label {
      display: block;
      margin-bottom: .65rem;
      color: var(--quiet);
      font: 650 .68rem/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .endpoint {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: .65rem;
      padding: .85rem 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      font: 600 .82rem/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .method { color: var(--accent); font-size: .7rem; letter-spacing: .08em; }
    .endpoint code { min-width: 0; overflow-wrap: anywhere; color: #d8d6d0; }

    .module-links {
      display: grid;
      gap: .25rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .module-links a {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      min-height: 2rem;
      padding-block: .3rem;
      color: #d8d6d0;
      font-size: .84rem;
      font-weight: 650;
      white-space: nowrap;
      text-decoration-color: transparent;
      text-underline-offset: .28rem;
    }

    .module-links a::after { color: var(--accent); content: "↗"; }
    .module-links a:hover { color: var(--text); text-decoration-color: var(--accent); }

    a:focus-visible {
      outline: 2px solid var(--accent, var(--artifact));
      outline-offset: .3rem;
    }

    .site-footer {
      display: flex;
      justify-content: space-between;
      gap: 2rem;
      padding: 2rem 0 3.25rem;
      color: var(--quiet);
      font: 600 .72rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .site-footer p { margin: 0; }

    @media (hover: hover) {
      .module { transition: background-color 160ms ease; }
      .module:hover { background: var(--surface-hover); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }

    @media (max-width: 52rem) {
      .hero { grid-template-columns: 1fr; align-items: start; }
      .hero-intro { max-width: 36rem; }
      .module { grid-template-columns: 3rem minmax(0, 1fr); }
      .module-technical { grid-column: 2; }
    }

    @media (max-width: 36rem) {
      .shell { width: min(var(--shell), calc(100% - 2rem)); }
      .site-header { min-height: 5.5rem; }
      .registry-count { max-width: 7rem; text-align: right; line-height: 1.4; }
      main { padding-top: 3.75rem; }
      h1 { font-size: clamp(3.2rem, 17vw, 5.4rem); }
      .module { grid-template-columns: 1fr; gap: 1.35rem; }
      .module-index { margin: 0; }
      .module-technical { grid-column: auto; }
      .site-footer { flex-direction: column; gap: .5rem; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#mcp-registry">Skip to MCP registry</a>
  <div class="shell">
    <header class="site-header">
      <a class="identity" href="/" aria-label="Personal MCP Hub home">
        <img src="/hub.svg" width="44" height="44" alt="">
        <span class="identity-copy"><strong>Aravind M J</strong><span>Personal MCP Hub</span></span>
      </a>
      <p class="registry-count">02 MCP services</p>
    </header>

    <main id="main-content">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Personal infrastructure · Purpose-built interfaces</p>
          <h1 id="page-title">Small tools, built to be used.</h1>
        </div>
        <p class="hero-intro">Two purpose-built MCP services. Each has a dedicated endpoint, a harness-neutral installation guide, and a companion skill for agents.</p>
      </section>

      <section class="registry" id="mcp-registry" aria-label="Available MCP services">
        <article class="module module--artifact" data-mcp-entry="artifact" aria-labelledby="artifact-title">
          <p class="module-index" aria-hidden="true">01</p>
          <div class="module-copy">
            <div class="module-meta">
              <span class="access">Bearer protected</span>
              <span class="tool-count">5 tools</span>
            </div>
            <h2 id="artifact-title">HTML Artifact Publisher</h2>
            <p class="module-description">Publish, version, and share self-contained HTML through opaque, expiring signed links.</p>
          </div>
          <div class="module-technical">
            <div>
              <span class="endpoint-label">Streamable HTTP endpoint</span>
              <div class="endpoint"><span class="method">POST</span><code>/artifact/mcp</code></div>
            </div>
            <nav aria-label="HTML Artifact Publisher resources">
              <ul class="module-links">
                <li><a href="/artifact">Overview</a></li>
                <li><a href="/artifact/README.md">Install guide</a></li>
                <li><a href="/artifact/SKILL.md">Companion skill</a></li>
              </ul>
            </nav>
          </div>
        </article>

        <article class="module module--questionnaire" data-mcp-entry="questionnaire" aria-labelledby="questionnaire-title">
          <p class="module-index" aria-hidden="true">02</p>
          <div class="module-copy">
            <div class="module-meta">
              <span class="access">Bearer protected</span>
              <span class="tool-count">11 tools</span>
            </div>
            <h2 id="questionnaire-title">Questionnaire Collector</h2>
            <p class="module-description">Create revisioned questionnaires, share signed answer forms, and collect responses.</p>
          </div>
          <div class="module-technical">
            <div>
              <span class="endpoint-label">Streamable HTTP endpoint</span>
              <div class="endpoint"><span class="method">POST</span><code>/questionnaire/mcp</code></div>
            </div>
            <nav aria-label="Questionnaire Collector resources">
              <ul class="module-links">
                <li><a href="/questionnaire">Overview</a></li>
                <li><a href="/questionnaire/README.md">Install guide</a></li>
                <li><a href="/questionnaire/SKILL.md">Companion skill</a></li>
              </ul>
            </nav>
          </div>
        </article>
      </section>
    </main>

    <footer class="site-footer">
      <p>Model Context Protocol</p>
      <p>mcp.aravindmj.in</p>
    </footer>
  </div>
</body>
</html>`;

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const SKILL_NAME = "aravind-hosted-html-publisher";
export const SKILL_URL = "https://mcp.aravindmj.in/artifact/SKILL.md";
export const README_URL = "https://mcp.aravindmj.in/artifact/README.md";

const HARNESS_ROOTS = [
  { harness: "Hermes", relative: "skills" },
  { harness: "Cursor", relative: ".cursor/skills-cursor" },
  { harness: "Cursor", relative: ".cursor/skills" },
  { harness: "OpenCode", relative: ".config/opencode/skills" },
  { harness: "OpenCode", relative: ".opencode/skills" },
  { harness: "Claude Code", relative: ".claude/skills" },
  { harness: "Codex", relative: ".codex/skills" },
];

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isTargetSkill(content) {
  return /^---\s*$[\s\S]*?^name:\s*aravind-hosted-html-publisher\s*$/m.test(content);
}

async function existingDirectory(directory) {
  try {
    return (await lstat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function findSkillFiles(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        try {
          const content = await readFile(candidate, "utf8");
          if (isTargetSkill(content)) found.push({ path: candidate, content });
        } catch {
          // An unreadable candidate is not an installed, updateable copy.
        }
      }
    }
  }
  return found;
}

export async function discoverUserScopeInstallations(home = os.homedir()) {
  const installations = [];
  const seen = new Set();
  for (const descriptor of HARNESS_ROOTS) {
    const root = path.join(home, descriptor.relative);
    if (!(await existingDirectory(root))) continue;
    for (const match of await findSkillFiles(root)) {
      const resolved = await realpath(match.path).catch(() => path.resolve(match.path));
      const key = `${descriptor.harness}:${resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      installations.push({
        harness: descriptor.harness,
        path: resolved,
        current_sha256: sha256(match.content),
      });
    }
  }
  return installations.sort((left, right) =>
    left.harness.localeCompare(right.harness) || left.path.localeCompare(right.path));
}

export async function fetchAuthoritativeSkill(fetchImpl = fetch) {
  const response = await fetchImpl(SKILL_URL, { headers: { Accept: "text/markdown" } });
  if (!response.ok) throw new Error(`Could not fetch ${SKILL_URL}: HTTP ${response.status}`);
  const content = await response.text();
  if (!isTargetSkill(content)) throw new Error("Remote SKILL.md has the wrong or missing skill name");
  for (const marker of ["get_signed_url", "expires_in_seconds", "update_artifact", "Claude's built-in **Artifacts**"]) {
    if (!content.includes(marker)) throw new Error(`Remote SKILL.md is missing required marker: ${marker}`);
  }
  return { content, sha256: sha256(content) };
}

export function buildAgentPrompt({ installations, authoritativeSha256 }) {
  const targets = installations.length === 0
    ? "- No existing user-scope installations were detected. Do not create one."
    : installations.map((item) =>
      `- ${item.harness}: ${item.path}\n  Current SHA-256: ${item.current_sha256}`).join("\n");

  return `Update the existing user-scope copies of the ${SKILL_NAME} agent skill.

Authoritative sources:
- Skill: ${SKILL_URL}
- Installation guide: ${README_URL}
- Expected SKILL.md SHA-256: ${authoritativeSha256}

Detected user-scope installations (this list is authoritative for mutation scope):
${targets}

Requirements:
1. Fetch SKILL.md directly from the authoritative URL. Do not use a cached copy.
2. Verify the downloaded file has frontmatter name: ${SKILL_NAME}.
3. Verify its SHA-256 exactly matches ${authoritativeSha256}. Stop without modifying anything if it differs.
4. Replace only the exact existing SKILL.md paths listed above. These are user-scope installations. Do not create missing harness copies, touch project-local skills, or modify the hosted source/runtime copies.
5. Use an atomic write at every target and preserve restrictive existing file permissions where possible.
6. Do not read, print, rotate, move, or rewrite the MCP bearer token. Do not alter MCP registration or harness configuration.
7. Verify every updated target byte-for-byte matches the downloaded SKILL.md and report its final SHA-256.
8. Verify the skill now covers all of these current behaviors:
   - collision-safe MCP name aravind_html_publisher versus Claude's built-in Artifacts;
   - local .artifact-work HTML source file workflow;
   - publish_html, update_artifact, get_signed_url, list_artifacts, and delete_artifact;
   - one-week default signed URLs and custom expires_in_seconds from 60 to 31536000;
   - signed latest/version URLs and Basic Auth fallback;
   - 24-character alphanumeric IDs only;
   - gallery copy-link control plus hover trash button and deletion modal.
9. State which harnesses were updated, which detected copies were already current, and whether each harness needs a reload or new session.

If no installations are listed, make no changes and report that there was nothing installed at user scope.`;
}

function parseArguments(argv) {
  const options = { run: false, agent: "cursor", home: os.homedir(), workspace: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run") options.run = true;
    else if (argument === "--dry-run") options.run = false;
    else if (argument === "--agent") options.agent = argv[++index];
    else if (argument === "--home") options.home = path.resolve(argv[++index]);
    else if (argument === "--workspace") options.workspace = path.resolve(argv[++index]);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!['cursor', 'opencode', 'hermes'].includes(options.agent)) {
    throw new Error("--agent must be cursor, opencode, or hermes");
  }
  return options;
}

function agentCommand(agent, prompt, workspace, installations) {
  const targetDirectories = [...new Set(installations.map((item) => path.dirname(item.path)))];
  if (agent === "cursor") {
    const args = ["--print", "--output-format", "text", "--force", "--trust", "--workspace", workspace];
    for (const directory of targetDirectories) args.push("--add-dir", directory);
    args.push(prompt);
    return { command: "cursor-agent", args };
  }
  if (agent === "opencode") {
    return { command: "opencode", args: ["run", "--auto", "--dir", workspace, prompt] };
  }
  return { command: "hermes", args: ["-z", prompt, "--in", workspace] };
}

async function runAgent(agent, prompt, workspace, installations) {
  const invocation = agentCommand(agent, prompt, workspace, installations);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${invocation.command} exited with ${signal || code}`));
    });
  });
}

function usage() {
  return `Usage: node scripts/ask-agent-update-user-skills.js [options]\n\n` +
    `Without --run, prints the exact prompt and detected installations.\n\n` +
    `Options:\n` +
    `  --run                 Invoke an agent with the generated prompt\n` +
    `  --agent <name>        cursor (default), opencode, or hermes\n` +
    `  --home <path>         Override the user home used for discovery\n` +
    `  --workspace <path>    Agent working directory\n` +
    `  --dry-run             Print only; never invoke an agent\n` +
    `  -h, --help            Show this help\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const [installations, authoritative] = await Promise.all([
    discoverUserScopeInstallations(options.home),
    fetchAuthoritativeSkill(),
  ]);
  const prompt = buildAgentPrompt({ installations, authoritativeSha256: authoritative.sha256 });

  process.stdout.write(`Detected ${installations.length} installed user-scope cop${installations.length === 1 ? "y" : "ies"}.\n`);
  for (const item of installations) {
    const state = item.current_sha256 === authoritative.sha256 ? "current" : "stale";
    process.stdout.write(`- ${item.harness}: ${item.path} (${state})\n`);
  }
  process.stdout.write(`Authoritative SHA-256: ${authoritative.sha256}\n\n${prompt}\n`);

  if (options.run) {
    if (installations.length === 0) {
      process.stdout.write("\nNo installed user-scope copies found; agent invocation skipped.\n");
      return;
    }
    process.stdout.write(`\nInvoking ${options.agent} agent...\n`);
    await runAgent(options.agent, prompt, options.workspace, installations);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

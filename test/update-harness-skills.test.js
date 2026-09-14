import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  buildAgentPrompt,
  discoverUserScopeInstallations,
  fetchAuthoritativeSkill,
  SKILL_NAME,
  SKILL_URL,
} from "../scripts/ask-agent-update-user-skills.js";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryHome() {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-harness-discovery-"));
  temporaryRoots.push(root);
  return root;
}

function skill(body = "current") {
  return `---\nname: ${SKILL_NAME}\ndescription: test\n---\n\n# Skill\n${body}\n`;
}

test("discovers only existing user-scope copies across supported harness roots", async () => {
  const home = await temporaryHome();
  const hermes = path.join(home, "skills", "productivity", SKILL_NAME, "SKILL.md");
  const cursor = path.join(home, ".cursor", "skills-cursor", SKILL_NAME, "SKILL.md");
  const unrelated = path.join(home, ".config", "opencode", "skills", "other", "SKILL.md");
  for (const file of [hermes, cursor, unrelated]) await mkdir(path.dirname(file), { recursive: true });
  await writeFile(hermes, skill("hermes"));
  await writeFile(cursor, skill("cursor"));
  await writeFile(unrelated, "---\nname: other\ndescription: no\n---\n# Other\n");

  const installations = await discoverUserScopeInstallations(home);
  assert.deepEqual(installations.map(({ harness, path: file }) => [harness, file]), [
    ["Cursor", cursor],
    ["Hermes", hermes],
  ]);
});

test("validates the authoritative remote skill and computes its hash", async () => {
  const content = skill("get_signed_url expires_in_seconds update_artifact Claude's built-in **Artifacts**");
  const fakeFetch = async (url) => {
    assert.equal(url, SKILL_URL);
    return new Response(content, { status: 200, headers: { "content-type": "text/markdown" } });
  };
  const authoritative = await fetchAuthoritativeSkill(fakeFetch);
  assert.equal(authoritative.content, content);
  assert.match(authoritative.sha256, /^[a-f0-9]{64}$/);
});

test("agent prompt limits writes to detected copies and protects credentials", () => {
  const prompt = buildAgentPrompt({
    authoritativeSha256: "a".repeat(64),
    installations: [
      { harness: "Hermes", path: "/home/user/skills/productivity/aravind-hosted-html-publisher/SKILL.md", current_sha256: "b".repeat(64) },
    ],
  });
  assert.match(prompt, /Detected user-scope installations/);
  assert.match(prompt, /Hermes: \/home\/user\/skills\/productivity/);
  assert.match(prompt, /Do not create missing harness copies/);
  assert.match(prompt, /Do not read, print, rotate, move, or rewrite the MCP bearer token/);
  assert.match(prompt, /get_signed_url/);
  assert.match(prompt, /31536000/);
  assert.match(prompt, /Claude's built-in Artifacts/);
});

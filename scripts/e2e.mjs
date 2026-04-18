#!/usr/bin/env node
// End-to-end smoke test.
// Boots a throwaway claude-config dir (via CLAUDE_CONFIG_DIR), fabricates
// config + cache + JSONL, and pipes realistic stdin payloads into the built
// bin/ entry points. Assertions check stdout shape for both hooks and the
// statusline. Invoke via `pnpm e2e` after `pnpm run build`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "plugin", "bin");
const log = (m) => process.stdout.write(`[e2e] ${m}\n`);
const fail = (m) => { process.stderr.write(`[e2e] FAIL: ${m}\n`); process.exit(1); };

for (const p of [
  join(BIN, "hooks", "user-prompt-submit.js"),
  join(BIN, "hooks", "pre-tool-use.js"),
  join(BIN, "statusline.js"),
]) if (!existsSync(p)) fail(`missing build output: ${p} — run \`pnpm run build\` first`);

// Sandbox --------------------------------------------------------------------
const sandbox = mkdtempSync(join(tmpdir(), `claude-test-${Date.now()}-`));
const CLAUDE_CONFIG_DIR = sandbox;
const limiterDir = join(CLAUDE_CONFIG_DIR, "usage-limiter");
const projectsDir = join(CLAUDE_CONFIG_DIR, "projects");
mkdirSync(limiterDir, { recursive: true });
mkdirSync(projectsDir, { recursive: true });

const projectCwd = "/private/tmp/e2e-test-project";
const encoded = projectCwd.replace(/\//g, "-");
const projectJsonlDir = join(projectsDir, encoded);
mkdirSync(projectJsonlDir, { recursive: true });

const now = Math.floor(Date.now() / 1000);
const resetsAt = now + 3 * 86400;

writeFileSync(
  join(limiterDir, "config.json"),
  JSON.stringify({ version: 1, projects: { [projectCwd]: { weeklyPercent: 0.001 } } }, null, 2),
);
writeFileSync(
  join(limiterDir, "cache.json"),
  JSON.stringify({ updatedAt: now, rateLimits: { sevenDay: { usedPercentage: 50, resetsAt } } }, null, 2),
);

const lines = [];
for (let i = 0; i < 5; i++) {
  lines.push(JSON.stringify({
    type: "assistant",
    timestamp: new Date().toISOString(),
    message: {
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }));
}
writeFileSync(join(projectJsonlDir, "fake.jsonl"), lines.join("\n") + "\n");
log(`sandbox CLAUDE_CONFIG_DIR = ${CLAUDE_CONFIG_DIR}`);

// Helpers --------------------------------------------------------------------
function pipe(script, payload) {
  const res = spawnSync("node", [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR }, encoding: "utf8", timeout: 10_000,
  });
  if (res.error) fail(`spawn failed: ${res.error.message}`);
  return res;
}

let passed = 0, failed = 0;
function assertOk(label, cond, details = "") {
  if (cond) { passed++; log(`PASS ${label}`); }
  else { failed++; log(`FAIL ${label}${details ? " — " + details : ""}`); }
}

// 1. UserPromptSubmit --------------------------------------------------------
{
  const res = pipe(join(BIN, "hooks", "user-prompt-submit.js"), {
    session_id: "e2e-ups-1", transcript_path: join(projectJsonlDir, "fake.jsonl"),
    cwd: projectCwd, permission_mode: "default", hook_event_name: "UserPromptSubmit",
    prompt: "hello",
  });
  let parsed = null;
  try { parsed = JSON.parse(res.stdout.trim()); } catch { /* ignore */ }
  assertOk("UserPromptSubmit exits 0", res.status === 0, `status=${res.status}, stderr=${res.stderr}`);
  assertOk("UserPromptSubmit emits {decision:block}",
    parsed && parsed.decision === "block" && typeof parsed.reason === "string",
    `stdout=${res.stdout}`);
  assertOk("UserPromptSubmit reason mentions overshoot",
    parsed && /exceeded/.test(parsed.reason), `reason=${parsed && parsed.reason}`);
}

// 2. PreToolUse --------------------------------------------------------------
try { rmSync(join(limiterDir, "pretooluse-throttle")); } catch { /* ignore */ }
{
  const res = pipe(join(BIN, "hooks", "pre-tool-use.js"), {
    session_id: "e2e-ptu-1", transcript_path: join(projectJsonlDir, "fake.jsonl"),
    cwd: projectCwd, permission_mode: "default", hook_event_name: "PreToolUse",
    tool_name: "Bash", tool_input: { command: "echo hi" },
  });
  let parsed = null;
  try { parsed = JSON.parse(res.stdout.trim()); } catch { /* ignore */ }
  const hso = parsed && parsed.hookSpecificOutput;
  assertOk("PreToolUse exits 0", res.status === 0, `status=${res.status}, stderr=${res.stderr}`);
  assertOk("PreToolUse emits hookSpecificOutput.permissionDecision=deny",
    hso && hso.hookEventName === "PreToolUse" && hso.permissionDecision === "deny",
    `stdout=${res.stdout}`);
  assertOk("PreToolUse reason tells model to stop retrying",
    hso && /DO NOT retry/.test(hso.permissionDecisionReason),
    `reason=${hso && hso.permissionDecisionReason}`);
}

// 3. Statusline --------------------------------------------------------------
{
  const res = pipe(join(BIN, "statusline.js"), {
    session_id: "e2e-sl-1", cwd: projectCwd,
    workspace: { current_dir: projectCwd },
    model: { display_name: "Claude Sonnet 4.6" },
    rate_limits: { seven_day: { used_percentage: 50, resets_at: resetsAt } },
  });
  const plain = res.stdout.replace(/\x1b\[[0-9;]*m/g, "");
  assertOk("statusline exits 0", res.status === 0, `status=${res.status}, stderr=${res.stderr}`);
  assertOk("statusline output includes project name", plain.includes("e2e-test-project"),
    `plain=${JSON.stringify(plain)}`);
  assertOk("statusline shows project % / limit %", /%\s*\/\s*[\d.]+%/.test(plain),
    `plain=${JSON.stringify(plain)}`);
  assertOk("statusline shows account %/w", /acct:\s*\d+%\/w/.test(plain),
    `plain=${JSON.stringify(plain)}`);
}

// Summary --------------------------------------------------------------------
log("");
log(`${passed} passed, ${failed} failed`);
if (failed === 0) {
  rmSync(sandbox, { recursive: true, force: true });
  log("sandbox cleaned");
  process.exit(0);
} else {
  log(`sandbox kept at ${sandbox} for inspection`);
  process.exit(1);
}

// PreToolUse hook.
// Reads JSON payload from stdin, calls checkLimit(cwd).
// On overshoot: emits the PreToolUse-specific block shape and exits 0.
//
//   { "hookSpecificOutput": {
//       "hookEventName": "PreToolUse",
//       "permissionDecision": "deny",
//       "permissionDecisionReason": "..." } }
//
// Throttle: within a single node process (and across processes via a tiny file at
// ~/.claude/usage-limiter/pretooluse-throttle), if the last check was < 2 s ago we
// skip re-scanning and fall through to allow. Keeps avg overhead well under 50 ms
// on heavy tool-use loops.
//
// Error policy: any exception → exit 0 (allow).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkLimit } from "../lib/check-limit.js";
import { logError } from "../lib/errors.js";
import { USAGE_LIMITER_DIR } from "../lib/paths.js";
import { join } from "node:path";

export const THROTTLE_PATH = join(USAGE_LIMITER_DIR, "pretooluse-throttle");
const THROTTLE_WINDOW_MS = 2_000;

// In-process cache first — saves a syscall when the same node process happens to
// be reused (unlikely for hooks but cheap).
let lastCheckMs = 0;

interface PreToolUsePayload {
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { command?: string; [k: string]: unknown };
}

// Whitelist: never block a Bash tool call that invokes one of our own bin/
// scripts — otherwise /claude-usage-limiter:set can't be used to unblock
// yourself once you're over limit.
const OWN_BIN_RE = /claude-usage-limiter[^\s'"]*\/bin\/(commands|hooks)\//;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function throttled(now: number): boolean {
  if (now - lastCheckMs < THROTTLE_WINDOW_MS) return true;
  try {
    const raw = readFileSync(THROTTLE_PATH, "utf8").trim();
    const t = Number(raw);
    if (isFinite(t) && now - t < THROTTLE_WINDOW_MS) return true;
  } catch {
    // missing throttle file is fine
  }
  return false;
}

function stampThrottle(now: number): void {
  lastCheckMs = now;
  try {
    mkdirSync(dirname(THROTTLE_PATH), { recursive: true });
    writeFileSync(THROTTLE_PATH, String(now));
  } catch {
    // best-effort; in-process timestamp is the primary defence anyway
  }
}

// Shape the PreToolUse deny payload. Exported for tests.
export function denyOutput(reason: string): object {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `${reason} ` +
        `DO NOT retry this tool call — you are over the configured weekly budget. ` +
        `End the current turn so the user can adjust the limit or wait for the reset.`,
    },
  };
}

export async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const payload = JSON.parse(raw) as PreToolUsePayload;
    const cwd = payload.cwd;
    if (!cwd) process.exit(0);

    if (payload.tool_name === "Bash" && typeof payload.tool_input?.command === "string") {
      if (OWN_BIN_RE.test(payload.tool_input.command)) process.exit(0);
    }

    const now = Date.now();
    if (throttled(now)) process.exit(0);
    stampThrottle(now);

    const verdict = checkLimit(cwd);
    if (verdict.overshoot) {
      process.stdout.write(JSON.stringify(denyOutput(verdict.reason)));
    }
    process.exit(0);
  } catch (err) {
    logError("pre-tool-use", err);
    process.exit(0);
  }
}

// Don't auto-run when imported by tests.
if (process.env.PRE_TOOL_USE_NO_AUTORUN !== "1") {
  void main();
}

// UserPromptSubmit hook.
// Reads JSON payload from stdin, calls checkLimit(cwd).
// If overshoot: emit {"decision":"block","reason":"..."} and exit 0.
// Otherwise: exit 0 silently. Any exception → log + exit 0 (never block on bugs).
import { checkLimit } from "../lib/check-limit.js";
import { logError } from "../lib/errors.js";

interface UserPromptSubmitPayload {
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const payload = JSON.parse(raw) as UserPromptSubmitPayload;
    const cwd = payload.cwd;
    if (!cwd) process.exit(0);

    const verdict = checkLimit(cwd);
    if (verdict.overshoot) {
      const out = {
        decision: "block",
        reason: verdict.reason,
      };
      process.stdout.write(JSON.stringify(out));
    }
    process.exit(0);
  } catch (err) {
    logError("user-prompt-submit", err);
    process.exit(0);
  }
}

void main();

// SessionStart hook — silently wire the statusline into ~/.claude/settings.json
// the first time the plugin is loaded. Leaves a marker file so subsequent
// sessions are a no-op. Never blocks session startup.
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logError } from "../lib/errors.js";
import { USAGE_LIMITER_DIR } from "../lib/paths.js";
import { wireStatusline } from "../lib/statusline-installer.js";

const STATE_FILE = join(USAGE_LIMITER_DIR, ".auto-install-done");

function main(): void {
  try {
    if (existsSync(STATE_FILE)) return;

    const r = wireStatusline();

    // Write marker regardless of outcome so we don't nag every session.
    try {
      mkdirSync(USAGE_LIMITER_DIR, { recursive: true });
      writeFileSync(STATE_FILE, new Date().toISOString() + "\n");
    } catch {
      // non-fatal — worst case we retry on next session
    }

    // One-time stderr note. Claude Code shows SessionStart stderr in the
    // session's additional context panel.
    switch (r.status) {
      case "installed":
        process.stderr.write(
          "[usage-limiter] wired statusline into settings.json on first session.\n",
        );
        break;
      case "other-present":
        process.stderr.write(
          "[usage-limiter] existing statusLine detected; leaving it alone. " +
            "Run /usage-limiter:install-statusline to override.\n",
        );
        break;
      case "invalid-settings":
        process.stderr.write(
          "[usage-limiter] ~/.claude/settings.json is not valid JSON; cannot auto-install. " +
            "Fix the file and run /usage-limiter:install-statusline.\n",
        );
        break;
      // "already-installed" and "no-plugin-root" → silent
    }
  } catch (err) {
    logError("hooks:session-start", err);
  }
}

main();
process.exit(0);

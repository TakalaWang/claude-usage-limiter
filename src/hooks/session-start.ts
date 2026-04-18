// SessionStart hook — keeps ~/.claude/settings.json's statusLine pointing at
// the CURRENT plugin install. Runs every session (no state file) so that when
// the plugin is reinstalled at a new version dir, the settings.json reference
// gets refreshed automatically. Silent unless something actually changed.
// Never blocks session startup.
import { logError } from "../lib/errors.js";
import { wireStatusline } from "../lib/statusline-installer.js";

function main(): void {
  try {
    const r = wireStatusline();
    switch (r.status) {
      case "installed":
        process.stderr.write(
          "[usage-limiter] wired statusline into settings.json on first session.\n",
        );
        break;
      case "refreshed":
        process.stderr.write(
          `[usage-limiter] refreshed statusline path to the current install.\n`,
        );
        break;
      case "other-present":
        process.stderr.write(
          "[usage-limiter] existing non-plugin statusLine detected; leaving it alone. " +
            "Run /claude-usage-limiter:install-statusline to override.\n",
        );
        break;
      case "invalid-settings":
        process.stderr.write(
          "[usage-limiter] ~/.claude/settings.json is not valid JSON; cannot auto-install. " +
            "Fix the file and run /claude-usage-limiter:install-statusline.\n",
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

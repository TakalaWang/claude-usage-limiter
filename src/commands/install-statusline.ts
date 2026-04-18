// /install-statusline — patches ~/.claude/settings.json to wire up the plugin statusline.
// Usually not needed manually — the SessionStart hook auto-wires on first session.
// This command exists for re-installation or recovery from a rejected auto-install.
import { logError } from "../lib/errors.js";
import { SETTINGS_PATH } from "../lib/paths.js";
import { wireStatusline } from "../lib/statusline-installer.js";

function main(): void {
  try {
    const r = wireStatusline();
    switch (r.status) {
      case "no-plugin-root":
        process.stdout.write(
          "install-statusline: could not resolve CLAUDE_PLUGIN_ROOT. Aborting.\n",
        );
        return;
      case "invalid-settings":
        process.stdout.write(
          `install-statusline: ${SETTINGS_PATH} is not valid JSON. Fix it first. (${r.error})\n`,
        );
        return;
      case "already-installed":
        process.stdout.write(
          `install-statusline: already installed (${r.command}). Nothing to do.\n`,
        );
        return;
      case "other-present":
        process.stdout.write(
          `install-statusline: ${SETTINGS_PATH} already has a statusLine:\n` +
            `    ${r.existing}\n` +
            `Refusing to overwrite. Remove the existing "statusLine" block and re-run.\n` +
            `Suggested command:\n    ${r.suggested}\n`,
        );
        return;
      case "installed":
        if (r.backup) {
          process.stdout.write(
            `install-statusline: backed up existing settings to ${r.backup}\n`,
          );
        }
        process.stdout.write(
          `install-statusline: patched ${SETTINGS_PATH} — statusLine now runs:\n    ${r.command}\n`,
        );
        return;
    }
  } catch (err) {
    logError("commands:install-statusline", err);
    process.stdout.write(
      "install-statusline: unexpected error — see ~/.claude/usage-limiter/errors.log\n",
    );
  }
}

main();

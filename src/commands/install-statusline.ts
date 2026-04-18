// /install-statusline — patches ~/.claude/settings.json to wire up the plugin statusline.
// Backs up the existing file. Bails if statusLine already set (user must re-run to overwrite).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { logError } from "../lib/errors.js";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string };
  [k: string]: unknown;
}

function resolvePluginRoot(): string | null {
  const env = process.env.CLAUDE_PLUGIN_ROOT;
  if (env) return env;
  // Fallback: walk up from this file (bin/commands/install-statusline.js) → plugin root.
  try {
    // import.meta.url unreliable in bundled form; use __filename via process.argv[1].
    const script = process.argv[1];
    if (script) {
      // script lives at <root>/bin/commands/install-statusline.js
      return resolve(dirname(script), "..", "..");
    }
  } catch {
    // ignore
  }
  return null;
}

export function main(): void {
  try {
    const root = resolvePluginRoot();
    if (!root) {
      process.stdout.write(
        "install-statusline: could not resolve CLAUDE_PLUGIN_ROOT. Aborting.\n",
      );
      return;
    }

    const command = `node ${join(root, "bin", "statusline.js")}`;

    let current: ClaudeSettings = {};
    if (existsSync(SETTINGS_PATH)) {
      try {
        current = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as ClaudeSettings;
      } catch (err) {
        process.stdout.write(
          `install-statusline: ${SETTINGS_PATH} is not valid JSON. Fix it first. (${String(err)})\n`,
        );
        return;
      }
    } else {
      mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    }

    if (current.statusLine && current.statusLine.command) {
      if (current.statusLine.command === command) {
        process.stdout.write(
          `install-statusline: already installed (${current.statusLine.command}). Nothing to do.\n`,
        );
        return;
      }
      process.stdout.write(
        `install-statusline: ${SETTINGS_PATH} already has a statusLine:\n` +
          `    ${current.statusLine.command}\n` +
          `Refusing to overwrite. To replace it, remove the existing "statusLine" block from\n` +
          `${SETTINGS_PATH} and re-run this command. Suggested command:\n` +
          `    ${command}\n`,
      );
      return;
    }

    // Backup before modifying.
    if (existsSync(SETTINGS_PATH)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${SETTINGS_PATH}.bak-${ts}`;
      copyFileSync(SETTINGS_PATH, backup);
      process.stdout.write(`install-statusline: backed up existing settings to ${backup}\n`);
    }

    current.statusLine = { type: "command", command };
    writeFileSync(SETTINGS_PATH, JSON.stringify(current, null, 2) + "\n");
    process.stdout.write(
      `install-statusline: patched ${SETTINGS_PATH} — statusLine now runs:\n    ${command}\n`,
    );
  } catch (err) {
    logError("commands:install-statusline", err);
    process.stdout.write(
      "install-statusline: unexpected error — see ~/.claude/usage-limiter/errors.log\n",
    );
  }
}

main();

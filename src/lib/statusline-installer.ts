// Shared: wire the plugin's statusline command into ~/.claude/settings.json.
// Used by both the /install-statusline slash command (verbose) and the
// SessionStart hook (silent auto-install on first run).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SETTINGS_PATH } from "./paths.js";

export type InstallResult =
  | { status: "installed"; command: string; backup?: string }
  | { status: "already-installed"; command: string }
  | { status: "other-present"; existing: string; suggested: string }
  | { status: "no-plugin-root" }
  | { status: "invalid-settings"; error: string };

export function resolvePluginRoot(): string | null {
  const env = process.env.CLAUDE_PLUGIN_ROOT;
  if (env && env.length > 0) return env;
  // Fallback: our bundled entry points live at <root>/bin/**/*.js — walk up.
  try {
    const script = process.argv[1];
    if (!script) return null;
    // bin/hooks/*.js or bin/commands/*.js → 2 levels up = root
    return resolve(dirname(script), "..", "..");
  } catch {
    return null;
  }
}

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string };
  [k: string]: unknown;
}

export function wireStatusline(): InstallResult {
  const root = resolvePluginRoot();
  if (!root) return { status: "no-plugin-root" };

  const command = `node ${join(root, "bin", "statusline.js")}`;

  let current: ClaudeSettings = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      current = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as ClaudeSettings;
    } catch (err) {
      return { status: "invalid-settings", error: String(err) };
    }
  } else {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  }

  if (current.statusLine?.command) {
    if (current.statusLine.command === command) {
      return { status: "already-installed", command };
    }
    return {
      status: "other-present",
      existing: current.statusLine.command,
      suggested: command,
    };
  }

  let backup: string | undefined;
  if (existsSync(SETTINGS_PATH)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${SETTINGS_PATH}.bak-${ts}`;
    copyFileSync(SETTINGS_PATH, backup);
  }

  current.statusLine = { type: "command", command };
  writeFileSync(SETTINGS_PATH, JSON.stringify(current, null, 2) + "\n");
  return { status: "installed", command, backup };
}

#!/usr/bin/env node

// src/hooks/session-start.ts
import { existsSync as existsSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/lib/errors.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// src/lib/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
function claudeDir() {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.length > 0) return override;
  return join(homedir(), ".claude");
}
var CLAUDE = claudeDir();
var USAGE_LIMITER_DIR = join(CLAUDE, "usage-limiter");
var CONFIG_PATH = join(USAGE_LIMITER_DIR, "config.json");
var CACHE_PATH = join(USAGE_LIMITER_DIR, "cache.json");
var ERRORS_LOG_PATH = join(USAGE_LIMITER_DIR, "errors.log");
var PROJECTS_DIR = join(CLAUDE, "projects");
var SETTINGS_PATH = join(CLAUDE, "settings.json");

// src/lib/errors.ts
function logError(context, err) {
  try {
    mkdirSync(dirname(ERRORS_LOG_PATH), { recursive: true });
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${context}: ${err instanceof Error ? err.stack ?? err.message : String(err)}
`;
    appendFileSync(ERRORS_LOG_PATH, line);
  } catch {
  }
}

// src/lib/statusline-installer.ts
import { copyFileSync, existsSync, mkdirSync as mkdirSync2, readFileSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";
function resolvePluginRoot() {
  const env = process.env.CLAUDE_PLUGIN_ROOT;
  if (env && env.length > 0) return env;
  try {
    const script = process.argv[1];
    if (!script) return null;
    return resolve(dirname2(script), "..", "..");
  } catch {
    return null;
  }
}
function wireStatusline() {
  const root = resolvePluginRoot();
  if (!root) return { status: "no-plugin-root" };
  const command = `node ${join2(root, "bin", "statusline.js")}`;
  let current = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      current = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    } catch (err) {
      return { status: "invalid-settings", error: String(err) };
    }
  } else {
    mkdirSync2(dirname2(SETTINGS_PATH), { recursive: true });
  }
  if (current.statusLine?.command) {
    if (current.statusLine.command === command) {
      return { status: "already-installed", command };
    }
    return {
      status: "other-present",
      existing: current.statusLine.command,
      suggested: command
    };
  }
  let backup;
  if (existsSync(SETTINGS_PATH)) {
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    backup = `${SETTINGS_PATH}.bak-${ts}`;
    copyFileSync(SETTINGS_PATH, backup);
  }
  current.statusLine = { type: "command", command };
  writeFileSync(SETTINGS_PATH, JSON.stringify(current, null, 2) + "\n");
  return { status: "installed", command, backup };
}

// src/hooks/session-start.ts
var STATE_FILE = join3(USAGE_LIMITER_DIR, ".auto-install-done");
function main() {
  try {
    if (existsSync2(STATE_FILE)) return;
    const r = wireStatusline();
    try {
      mkdirSync3(USAGE_LIMITER_DIR, { recursive: true });
      writeFileSync2(STATE_FILE, (/* @__PURE__ */ new Date()).toISOString() + "\n");
    } catch {
    }
    switch (r.status) {
      case "installed":
        process.stderr.write(
          "[usage-limiter] wired statusline into settings.json on first session.\n"
        );
        break;
      case "other-present":
        process.stderr.write(
          "[usage-limiter] existing statusLine detected; leaving it alone. Run /usage-limiter:install-statusline to override.\n"
        );
        break;
      case "invalid-settings":
        process.stderr.write(
          "[usage-limiter] ~/.claude/settings.json is not valid JSON; cannot auto-install. Fix the file and run /usage-limiter:install-statusline.\n"
        );
        break;
    }
  } catch (err) {
    logError("hooks:session-start", err);
  }
}
main();
process.exit(0);

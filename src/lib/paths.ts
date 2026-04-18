// Shared filesystem paths for the plugin.
// Respects CLAUDE_CONFIG_DIR (Claude Code's override) and falls back to ~/.claude.
import { homedir } from "node:os";
import { join } from "node:path";

export function claudeDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.length > 0) return override;
  return join(homedir(), ".claude");
}

const CLAUDE = claudeDir();

export const USAGE_LIMITER_DIR = join(CLAUDE, "usage-limiter");
export const CONFIG_PATH = join(USAGE_LIMITER_DIR, "config.json");
export const CACHE_PATH = join(USAGE_LIMITER_DIR, "cache.json");
export const ERRORS_LOG_PATH = join(USAGE_LIMITER_DIR, "errors.log");
export const PROJECTS_DIR = join(CLAUDE, "projects");
export const SETTINGS_PATH = join(CLAUDE, "settings.json");

// /Users/takala/code/escape-group -> -Users-takala-code-escape-group
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

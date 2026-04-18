// Shared filesystem paths for the plugin.
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

export const USAGE_LIMITER_DIR = join(HOME, ".claude", "usage-limiter");
export const CONFIG_PATH = join(USAGE_LIMITER_DIR, "config.json");
export const CACHE_PATH = join(USAGE_LIMITER_DIR, "cache.json");
export const ERRORS_LOG_PATH = join(USAGE_LIMITER_DIR, "errors.log");
export const PROJECTS_DIR = join(HOME, ".claude", "projects");

// /Users/takala/code/escape-group -> -Users-takala-code-escape-group
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

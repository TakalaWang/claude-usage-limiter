// Append-only error logging for hook crashes. Hooks must never block on bugs.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ERRORS_LOG_PATH } from "./paths.js";

export function logError(context: string, err: unknown): void {
  try {
    mkdirSync(dirname(ERRORS_LOG_PATH), { recursive: true });
    const line = `[${new Date().toISOString()}] ${context}: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }\n`;
    appendFileSync(ERRORS_LOG_PATH, line);
  } catch {
    // Swallow — if we can't even log, give up silently.
  }
}

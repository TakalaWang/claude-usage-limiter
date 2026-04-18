// Atomic read/write of ~/.claude/usage-limiter/cache.json.
// Populated by statusline; read by hooks.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CACHE_PATH } from "./paths.js";

export interface RateLimitWindow {
  usedPercentage: number;
  resetsAt: number;
}

export interface UsageCache {
  updatedAt: number;
  rateLimits: {
    fiveHour?: RateLimitWindow;
    sevenDay?: RateLimitWindow;
  };
}

export function readCache(): UsageCache | null {
  let raw: string;
  try {
    raw = readFileSync(CACHE_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as UsageCache;
}

export function writeCache(cache: UsageCache): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, CACHE_PATH);
}

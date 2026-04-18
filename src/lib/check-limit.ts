// Core check: given a cwd, decide whether this project is over its configured
// weekly-percent limit.
//
// Math:
//   accountSevenDayPct = cache.rateLimits.sevenDay.usedPercentage  (0..100)
//   accountTokens      = sum of tokens across all ~/.claude/projects/**/*.jsonl
//                        since window start.
//   accountWeeklyBudget_tokens = accountTokens / (accountSevenDayPct / 100)
//   projectUsedPercent = projectTokens / accountWeeklyBudget_tokens * 100
//
// Algebraically equivalent: projectUsedPercent = sevenDayPct * (projectTokens/accountTokens).
// We prefer the second form — it's one expression and avoids a division by a tiny number.
//
// If the cache is absent, stale, or missing sevenDay data, we cannot compute
// projectUsedPercent at all; return { limited: true, overshoot: false, reason: "no cache" }.
// Callers (UserPromptSubmit hook) treat overshoot=false as "allow".
import { realpathSync } from "node:fs";
import { readCache, type UsageCache } from "./cache.js";
import { loadConfig, type UsageLimiterConfig } from "./config.js";
import { scanAllProjectsUsage, scanProjectUsage } from "./scan.js";
import { encodeCwd } from "./paths.js";

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const CACHE_STALE_SEC = 10 * 60;

export interface LimitVerdict {
  limited: boolean; // project is tracked in config
  overshoot: boolean; // over limit — block
  usedPercent: number; // 0..100 (of account weekly budget)
  limitPercent: number; // configured cap
  reason: string; // human-readable explanation
  cacheStale?: boolean;
}

function resolveProjectKey(cwd: string, config: UsageLimiterConfig): string | null {
  // Try realpath first, fall back to raw cwd.
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    // keep raw
  }
  if (config.projects[real]) return real;
  if (config.projects[cwd]) return cwd;
  return null;
}

function windowStart(cache: UsageCache | null): number {
  const resetsAt = cache?.rateLimits.sevenDay?.resetsAt;
  if (resetsAt && isFinite(resetsAt)) return resetsAt - SEVEN_DAYS_SEC;
  // Fallback: 7 days ago from now. Lets $/% scans work without rate_limits.
  return Math.floor(Date.now() / 1000) - SEVEN_DAYS_SEC;
}

export interface CheckLimitOptions {
  // for tests
  config?: UsageLimiterConfig | null;
  cache?: UsageCache | null;
  now?: number; // unix seconds
  scanProject?: (cwd: string, start: number) => { tokens: number };
  scanAll?: (start: number) => { total: { tokens: number } };
}

export function checkLimit(cwd: string, opts: CheckLimitOptions = {}): LimitVerdict {
  const config = opts.config !== undefined ? opts.config : loadConfig();
  if (!config) {
    return {
      limited: false,
      overshoot: false,
      usedPercent: 0,
      limitPercent: 0,
      reason: "no config — project unlimited",
    };
  }

  const key = resolveProjectKey(cwd, config);
  if (!key) {
    return {
      limited: false,
      overshoot: false,
      usedPercent: 0,
      limitPercent: 0,
      reason: "project not listed in config — unlimited",
    };
  }

  const limit = config.projects[key];
  const limitPercent = limit.weeklyPercent ?? 0;
  if (!limitPercent) {
    return {
      limited: false,
      overshoot: false,
      usedPercent: 0,
      limitPercent: 0,
      reason: "no weeklyPercent set — unlimited",
    };
  }

  const cache = opts.cache !== undefined ? opts.cache : readCache();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const cacheStale =
    !cache || !cache.updatedAt || now - cache.updatedAt > CACHE_STALE_SEC;
  const sevenDayPct = cache?.rateLimits.sevenDay?.usedPercentage;

  if (sevenDayPct === undefined || sevenDayPct <= 0 || cacheStale) {
    // Can't derive account budget. Allow + warn (design: "Allow + warn").
    return {
      limited: true,
      overshoot: false,
      usedPercent: 0,
      limitPercent,
      reason: cacheStale
        ? "cache missing/stale — allowing but usage unknown"
        : "no sevenDay data in cache — allowing",
      cacheStale: true,
    };
  }

  const start = windowStart(cache);
  const scanP = opts.scanProject ?? scanProjectUsage;
  const scanA = opts.scanAll ?? scanAllProjectsUsage;
  const projectTokens = scanP(cwd, start).tokens;
  const { total } = scanA(start);
  const accountTokens = total.tokens;

  if (accountTokens <= 0 || projectTokens <= 0) {
    return {
      limited: true,
      overshoot: false,
      usedPercent: 0,
      limitPercent,
      reason: "no usage recorded this week",
    };
  }

  const usedPercent = sevenDayPct * (projectTokens / accountTokens);
  const overshoot = usedPercent >= limitPercent;

  const resetAt = cache?.rateLimits.sevenDay?.resetsAt;
  const resetStr = resetAt ? new Date(resetAt * 1000).toISOString() : "unknown";
  const reason = overshoot
    ? `Project ${encodeCwd(cwd)} exceeded its ${limitPercent}% weekly budget ` +
      `(current ${usedPercent.toFixed(1)}%). Resets at ${resetStr}. ` +
      `To adjust, edit ~/.claude/usage-limiter/config.json.`
    : `under limit (${usedPercent.toFixed(1)}% of ${limitPercent}%)`;

  return {
    limited: true,
    overshoot,
    usedPercent,
    limitPercent,
    reason,
    cacheStale: false,
  };
}

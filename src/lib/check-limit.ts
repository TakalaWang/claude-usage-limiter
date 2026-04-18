// Core check: given a cwd, decide whether this project is over its configured
// weekly limit (either weeklyPercent or weeklyBudgetUSD).
//
// Percent math:
//   accountSevenDayPct = cache.rateLimits.sevenDay.usedPercentage  (0..100)
//   projectUsedPercent = sevenDayPct * (projectTokens / accountTokens)
//
// USD math:
//   projectUsedUsd = sum of assistant-message costUsd this week (from scan)
//   overshoot      = projectUsedUsd >= weeklyBudgetUSD
//
// Error policy: any signal we can't compute → overshoot=false (allow).
import { realpathSync } from "node:fs";
import { readCache, type UsageCache } from "./cache.js";
import { loadConfig, type UsageLimiterConfig } from "./config.js";
import { scanAllProjectsUsage, scanProjectUsage, type ProjectUsage } from "./scan.js";
import { encodeCwd } from "./paths.js";

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const CACHE_STALE_SEC = 10 * 60;

export type LimitKind = "percent" | "usd" | "none";

export interface LimitVerdict {
  limited: boolean; // project is tracked in config
  overshoot: boolean; // over limit — block
  kind: LimitKind;
  // percent fields (only meaningful when kind === "percent")
  usedPercent: number;
  limitPercent: number;
  // usd fields (only meaningful when kind === "usd")
  usedUsd: number;
  limitUsd: number;
  reason: string; // human-readable explanation
  cacheStale?: boolean;
}

function resolveProjectKey(cwd: string, config: UsageLimiterConfig): string | null {
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
  return Math.floor(Date.now() / 1000) - SEVEN_DAYS_SEC;
}

export interface CheckLimitOptions {
  config?: UsageLimiterConfig | null;
  cache?: UsageCache | null;
  now?: number; // unix seconds
  scanProject?: (cwd: string, start: number) => ProjectUsage;
  scanAll?: (start: number) => { total: ProjectUsage };
}

function emptyVerdict(reason: string): LimitVerdict {
  return {
    limited: false,
    overshoot: false,
    kind: "none",
    usedPercent: 0,
    limitPercent: 0,
    usedUsd: 0,
    limitUsd: 0,
    reason,
  };
}

export function checkLimit(cwd: string, opts: CheckLimitOptions = {}): LimitVerdict {
  const config = opts.config !== undefined ? opts.config : loadConfig();
  if (!config) return emptyVerdict("no config — project unlimited");

  const key = resolveProjectKey(cwd, config);
  if (!key) return emptyVerdict("project not listed in config — unlimited");

  const limit = config.projects[key];
  const cache = opts.cache !== undefined ? opts.cache : readCache();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const cacheStale =
    !cache || !cache.updatedAt || now - cache.updatedAt > CACHE_STALE_SEC;
  const start = windowStart(cache);
  const scanP = opts.scanProject ?? scanProjectUsage;
  const scanA = opts.scanAll ?? scanAllProjectsUsage;

  const resetAt = cache?.rateLimits.sevenDay?.resetsAt;
  const resetStr = resetAt ? new Date(resetAt * 1000).toISOString() : "unknown";
  const label = encodeCwd(cwd);

  // USD cap: doesn't need rate_limits at all (project-local math).
  if (limit.weeklyBudgetUSD !== undefined) {
    const limitUsd = limit.weeklyBudgetUSD;
    const project = scanP(cwd, start);
    const usedUsd = project.costUsd;
    const overshoot = usedUsd >= limitUsd;
    const reason = overshoot
      ? `Project ${label} exceeded its $${limitUsd.toFixed(2)} weekly budget ` +
        `(current $${usedUsd.toFixed(2)}). Resets at ${resetStr}. ` +
        `To adjust, edit ~/.claude/usage-limiter/config.json or run /usage-limiter:set.`
      : `under budget ($${usedUsd.toFixed(2)} of $${limitUsd.toFixed(2)})`;
    return {
      limited: true,
      overshoot,
      kind: "usd",
      usedPercent: 0,
      limitPercent: 0,
      usedUsd,
      limitUsd,
      reason,
      cacheStale: false,
    };
  }

  // Percent cap path (v0.1 semantics unchanged).
  const limitPercent = limit.weeklyPercent ?? 0;
  if (!limitPercent) return emptyVerdict("no limit set — unlimited");

  const sevenDayPct = cache?.rateLimits.sevenDay?.usedPercentage;
  if (sevenDayPct === undefined || sevenDayPct <= 0 || cacheStale) {
    return {
      limited: true,
      overshoot: false,
      kind: "percent",
      usedPercent: 0,
      limitPercent,
      usedUsd: 0,
      limitUsd: 0,
      reason: cacheStale
        ? "cache missing/stale — allowing but usage unknown"
        : "no sevenDay data in cache — allowing",
      cacheStale: true,
    };
  }

  const projectTokens = scanP(cwd, start).tokens;
  const { total } = scanA(start);
  const accountTokens = total.tokens;

  if (accountTokens <= 0 || projectTokens <= 0) {
    return {
      limited: true,
      overshoot: false,
      kind: "percent",
      usedPercent: 0,
      limitPercent,
      usedUsd: 0,
      limitUsd: 0,
      reason: "no usage recorded this week",
    };
  }

  const usedPercent = sevenDayPct * (projectTokens / accountTokens);
  const overshoot = usedPercent >= limitPercent;
  const reason = overshoot
    ? `Project ${label} exceeded its ${limitPercent}% weekly budget ` +
      `(current ${usedPercent.toFixed(1)}%). Resets at ${resetStr}. ` +
      `To adjust, edit ~/.claude/usage-limiter/config.json or run /usage-limiter:set.`
    : `under limit (${usedPercent.toFixed(1)}% of ${limitPercent}%)`;

  return {
    limited: true,
    overshoot,
    kind: "percent",
    usedPercent,
    limitPercent,
    usedUsd: 0,
    limitUsd: 0,
    reason,
    cacheStale: false,
  };
}

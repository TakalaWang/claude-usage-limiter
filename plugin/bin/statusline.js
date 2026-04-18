#!/usr/bin/env node

// src/statusline/index.ts
import { basename } from "node:path";

// src/lib/cache.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
function encodeCwd(cwd) {
  return cwd.replace(/\//g, "-");
}

// src/lib/cache.ts
function readCache() {
  let raw;
  try {
    raw = readFileSync(CACHE_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw);
}
function writeCache(cache) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, CACHE_PATH);
}

// src/lib/check-limit.ts
import { realpathSync } from "node:fs";

// src/lib/config.ts
import { readFileSync as readFileSync2 } from "node:fs";
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseConfig(raw) {
  if (!isRecord(raw)) throw new Error("config: root must be an object");
  if (raw.version !== 1) throw new Error("config: version must be 1");
  if (!isRecord(raw.projects)) throw new Error("config: projects must be an object");
  const projects = {};
  for (const [key, value] of Object.entries(raw.projects)) {
    if (!isRecord(value)) throw new Error(`config: projects[${key}] must be an object`);
    const hasPct = value.weeklyPercent !== void 0;
    const hasUsd = value.weeklyBudgetUSD !== void 0;
    if (hasPct && hasUsd) {
      throw new Error(
        `config: projects[${key}] sets both weeklyPercent and weeklyBudgetUSD \u2014 choose one`
      );
    }
    const limit = {};
    if (hasPct) {
      if (typeof value.weeklyPercent !== "number" || !isFinite(value.weeklyPercent)) {
        throw new Error(`config: projects[${key}].weeklyPercent must be a number`);
      }
      if (value.weeklyPercent <= 0 || value.weeklyPercent > 100) {
        throw new Error(`config: projects[${key}].weeklyPercent must be in (0, 100]`);
      }
      limit.weeklyPercent = value.weeklyPercent;
    }
    if (hasUsd) {
      if (typeof value.weeklyBudgetUSD !== "number" || !isFinite(value.weeklyBudgetUSD)) {
        throw new Error(`config: projects[${key}].weeklyBudgetUSD must be a number`);
      }
      if (value.weeklyBudgetUSD <= 0) {
        throw new Error(`config: projects[${key}].weeklyBudgetUSD must be > 0`);
      }
      limit.weeklyBudgetUSD = value.weeklyBudgetUSD;
    }
    if (!hasPct && !hasUsd) {
      continue;
    }
    projects[key] = limit;
  }
  return { version: 1, projects };
}
function loadConfig() {
  let raw;
  try {
    raw = readFileSync2(CONFIG_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const json = JSON.parse(raw);
  return parseConfig(json);
}

// src/lib/scan.ts
import { readdirSync, readFileSync as readFileSync3, statSync } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/errors.ts
import { appendFileSync, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function logError(context, err) {
  try {
    mkdirSync2(dirname2(ERRORS_LOG_PATH), { recursive: true });
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${context}: ${err instanceof Error ? err.stack ?? err.message : String(err)}
`;
    appendFileSync(ERRORS_LOG_PATH, line);
  } catch {
  }
}

// src/lib/pricing.ts
var PRICING = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }
};
var warned = /* @__PURE__ */ new Set();
function priceForModel(model) {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return PRICING.opus;
  if (m.includes("haiku")) return PRICING.haiku;
  if (m.includes("sonnet")) return PRICING.sonnet;
  const key = m || "<missing>";
  if (!warned.has(key)) {
    warned.add(key);
    logError("pricing:unknown-model", new Error(`unknown model "${key}" \u2014 falling back to Sonnet pricing`));
  }
  return PRICING.sonnet;
}
function costUsdFor(usage, model) {
  if (!usage) return 0;
  const p = priceForModel(model);
  const M = 1e6;
  return ((usage.input_tokens ?? 0) * p.input + (usage.output_tokens ?? 0) * p.output + (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite + (usage.cache_read_input_tokens ?? 0) * p.cacheRead) / M;
}

// src/lib/scan.ts
function usageTokens(u) {
  if (!u) return 0;
  return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}
function listJsonl(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join2(dir, f));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
function accumulateLine(line, sinceEpochMs, acc) {
  if (!line) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (parsed.type !== "assistant") return;
  const ts = parsed.timestamp ? Date.parse(parsed.timestamp) : NaN;
  if (!isFinite(ts) || ts < sinceEpochMs) return;
  const t = usageTokens(parsed.message?.usage);
  if (t <= 0) return;
  acc.tokens += t;
  acc.costUsd += costUsdFor(parsed.message?.usage, parsed.message?.model);
  acc.messages += 1;
}
function scanFile(path, sinceEpochMs, acc) {
  let contents;
  try {
    contents = readFileSync3(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) accumulateLine(line, sinceEpochMs, acc);
}
function scanProjectUsage(cwd, windowStartEpoch) {
  const dir = join2(PROJECTS_DIR, encodeCwd(cwd));
  const acc = { tokens: 0, costUsd: 0, messages: 0 };
  const sinceMs = windowStartEpoch * 1e3;
  for (const f of listJsonl(dir)) scanFile(f, sinceMs, acc);
  return acc;
}
function scanAllProjectsUsage(windowStartEpoch) {
  const total = { tokens: 0, costUsd: 0, messages: 0 };
  const perProject = {};
  const sinceMs = windowStartEpoch * 1e3;
  let entries;
  try {
    entries = readdirSync(PROJECTS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { total, perProject };
    }
    throw err;
  }
  for (const name of entries) {
    const sub = join2(PROJECTS_DIR, name);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const acc = { tokens: 0, costUsd: 0, messages: 0 };
    for (const f of listJsonl(sub)) scanFile(f, sinceMs, acc);
    perProject[name] = acc;
    total.tokens += acc.tokens;
    total.costUsd += acc.costUsd;
    total.messages += acc.messages;
  }
  return { total, perProject };
}

// src/lib/scan-cache.ts
import {
  mkdirSync as mkdirSync3,
  openSync,
  closeSync,
  readSync,
  readFileSync as readFileSync4,
  readdirSync as readdirSync2,
  renameSync as renameSync2,
  statSync as statSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
var SCAN_CACHE_PATH = join3(USAGE_LIMITER_DIR, "scan-cache.json");
var emptyCache = () => ({ version: 1, files: {} });
function readCache2() {
  try {
    const raw = readFileSync4(SCAN_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.files) return parsed;
  } catch {
  }
  return emptyCache();
}
function writeCache2(cache) {
  try {
    mkdirSync3(dirname3(SCAN_CACHE_PATH), { recursive: true });
    const tmp = `${SCAN_CACHE_PATH}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync2(tmp, JSON.stringify(cache));
    renameSync2(tmp, SCAN_CACHE_PATH);
  } catch {
  }
}
function readRange(path, start, end) {
  if (end <= start) return "";
  const fd = openSync(path, "r");
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
function listJsonl2(dir) {
  try {
    return readdirSync2(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join3(dir, f));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
function scanChunk(chunk, sinceEpochMs, acc) {
  let consumed = 0, maxTs = 0, cursor = 0;
  const totalBytes = Buffer.byteLength(chunk, "utf8");
  while (cursor < chunk.length) {
    const nl = chunk.indexOf("\n", cursor);
    if (nl === -1) break;
    const line = chunk.slice(cursor, nl);
    const before = acc.tokens;
    accumulateLine(line, sinceEpochMs, acc);
    if (acc.tokens !== before) {
      try {
        const ts = Date.parse(JSON.parse(line).timestamp ?? "");
        if (isFinite(ts) && ts > maxTs) maxTs = ts;
      } catch {
      }
    }
    cursor = nl + 1;
    consumed = Buffer.byteLength(chunk.slice(0, cursor), "utf8");
  }
  if (cursor >= chunk.length) consumed = totalBytes;
  return { consumedBytes: consumed, maxTs: Math.floor(maxTs / 1e3) };
}
function fullScanFile(path, sinceEpochMs) {
  const size = statSync2(path).size;
  const contents = readFileSync4(path, "utf8");
  const acc = { tokens: 0, costUsd: 0, messages: 0 };
  const { consumedBytes, maxTs } = scanChunk(contents, sinceEpochMs, acc);
  return { size, offset: consumedBytes, tokens: acc.tokens, costUsd: acc.costUsd, messages: acc.messages, lastTs: maxTs };
}
function addInto(total, e) {
  total.tokens += e.tokens;
  total.costUsd += e.costUsd;
  total.messages += e.messages;
}
function scanProjectIncremental(cwd, windowStartEpoch, cache) {
  const dir = join3(PROJECTS_DIR, encodeCwd(cwd));
  const windowStartMs = windowStartEpoch * 1e3;
  const total = { tokens: 0, costUsd: 0, messages: 0 };
  const seen = /* @__PURE__ */ new Set();
  for (const path of listJsonl2(dir)) {
    seen.add(path);
    let size;
    try {
      size = statSync2(path).size;
    } catch {
      continue;
    }
    const prior = cache.files[path];
    if (prior && prior.lastTs > 0 && prior.lastTs * 1e3 < windowStartMs) {
      delete cache.files[path];
    }
    const existing = cache.files[path];
    if (!existing || size < existing.offset) {
      const entry = fullScanFile(path, windowStartMs);
      cache.files[path] = entry;
      addInto(total, entry);
      continue;
    }
    if (size === existing.offset) {
      cache.files[path] = { ...existing, size };
      addInto(total, existing);
      continue;
    }
    const chunk = readRange(path, existing.offset, size);
    const delta = { tokens: 0, costUsd: 0, messages: 0 };
    const { consumedBytes, maxTs } = scanChunk(chunk, windowStartMs, delta);
    const merged = {
      size,
      offset: existing.offset + consumedBytes,
      tokens: existing.tokens + delta.tokens,
      costUsd: existing.costUsd + delta.costUsd,
      messages: existing.messages + delta.messages,
      lastTs: maxTs > existing.lastTs ? maxTs : existing.lastTs
    };
    cache.files[path] = merged;
    addInto(total, merged);
  }
  for (const p of Object.keys(cache.files)) {
    if (p.startsWith(dir + "/") && !seen.has(p)) delete cache.files[p];
  }
  return total;
}
function scanProjectUsageCached(cwd, windowStartEpoch) {
  const cache = readCache2();
  const total = scanProjectIncremental(cwd, windowStartEpoch, cache);
  writeCache2(cache);
  return total;
}

// src/lib/check-limit.ts
function scanProjectWithCache(cwd, start) {
  try {
    return scanProjectUsageCached(cwd, start);
  } catch {
    return scanProjectUsage(cwd, start);
  }
}
var SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
var CACHE_STALE_SEC = 10 * 60;
function resolveProjectKey(cwd, config) {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
  }
  if (config.projects[real]) return real;
  if (config.projects[cwd]) return cwd;
  return null;
}
function windowStart(cache) {
  const resetsAt = cache?.rateLimits.sevenDay?.resetsAt;
  if (resetsAt && isFinite(resetsAt)) return resetsAt - SEVEN_DAYS_SEC;
  return Math.floor(Date.now() / 1e3) - SEVEN_DAYS_SEC;
}
function emptyVerdict(reason) {
  return { limited: false, overshoot: false, kind: "none", usedPercent: 0, limitPercent: 0, usedUsd: 0, limitUsd: 0, reason };
}
function checkLimit(cwd, opts = {}) {
  const config = opts.config !== void 0 ? opts.config : loadConfig();
  if (!config) return emptyVerdict("no config \u2014 project unlimited");
  const key = resolveProjectKey(cwd, config);
  if (!key) return emptyVerdict("project not listed in config \u2014 unlimited");
  const limit = config.projects[key];
  const cache = opts.cache !== void 0 ? opts.cache : readCache();
  const now = opts.now ?? Math.floor(Date.now() / 1e3);
  const cacheStale = !cache || !cache.updatedAt || now - cache.updatedAt > CACHE_STALE_SEC;
  const start = windowStart(cache);
  const scanP = opts.scanProject ?? scanProjectWithCache;
  const scanA = opts.scanAll ?? scanAllProjectsUsage;
  const resetAt = cache?.rateLimits.sevenDay?.resetsAt;
  const resetStr = resetAt ? new Date(resetAt * 1e3).toISOString() : "unknown";
  const label = encodeCwd(cwd);
  if (limit.weeklyBudgetUSD !== void 0) {
    const limitUsd = limit.weeklyBudgetUSD;
    const usedUsd = scanP(cwd, start).costUsd;
    const overshoot2 = usedUsd >= limitUsd;
    const reason2 = overshoot2 ? `Project ${label} exceeded its $${limitUsd.toFixed(2)} weekly budget (current $${usedUsd.toFixed(2)}). Resets at ${resetStr}. To adjust, edit ~/.claude/usage-limiter/config.json or run /usage-limiter:set.` : `under budget ($${usedUsd.toFixed(2)} of $${limitUsd.toFixed(2)})`;
    return { limited: true, overshoot: overshoot2, kind: "usd", usedPercent: 0, limitPercent: 0, usedUsd, limitUsd, reason: reason2, cacheStale: false };
  }
  const limitPercent = limit.weeklyPercent ?? 0;
  if (!limitPercent) return emptyVerdict("no limit set \u2014 unlimited");
  const sevenDayPct = cache?.rateLimits.sevenDay?.usedPercentage;
  if (sevenDayPct === void 0 || sevenDayPct <= 0 || cacheStale) {
    return {
      limited: true,
      overshoot: false,
      kind: "percent",
      usedPercent: 0,
      limitPercent,
      usedUsd: 0,
      limitUsd: 0,
      reason: cacheStale ? "cache missing/stale \u2014 allowing but usage unknown" : "no sevenDay data in cache \u2014 allowing",
      cacheStale: true
    };
  }
  const projectTokens = scanP(cwd, start).tokens;
  const accountTokens = scanA(start).total.tokens;
  if (accountTokens <= 0 || projectTokens <= 0) {
    return { limited: true, overshoot: false, kind: "percent", usedPercent: 0, limitPercent, usedUsd: 0, limitUsd: 0, reason: "no usage recorded this week" };
  }
  const usedPercent = sevenDayPct * (projectTokens / accountTokens);
  const overshoot = usedPercent >= limitPercent;
  const reason = overshoot ? `Project ${label} exceeded its ${limitPercent}% weekly budget (current ${usedPercent.toFixed(1)}%). Resets at ${resetStr}. To adjust, edit ~/.claude/usage-limiter/config.json or run /usage-limiter:set.` : `under limit (${usedPercent.toFixed(1)}% of ${limitPercent}%)`;
  return { limited: true, overshoot, kind: "percent", usedPercent, limitPercent, usedUsd: 0, limitUsd: 0, reason, cacheStale: false };
}

// src/statusline/index.ts
var RESET = "\x1B[0m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var RED = "\x1B[31m";
function color(pct) {
  if (pct >= 95) return RED;
  if (pct >= 80) return YELLOW;
  return GREEN;
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function projectLabel(cwd) {
  if (!cwd) return "(no cwd)";
  return basename(cwd);
}
async function main() {
  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const cwd = input.workspace?.current_dir ?? input.cwd;
    if (input.rate_limits) {
      const cache = {
        updatedAt: Math.floor(Date.now() / 1e3),
        rateLimits: {
          fiveHour: input.rate_limits.five_hour ? {
            usedPercentage: input.rate_limits.five_hour.used_percentage ?? 0,
            resetsAt: input.rate_limits.five_hour.resets_at ?? 0
          } : void 0,
          sevenDay: input.rate_limits.seven_day ? {
            usedPercentage: input.rate_limits.seven_day.used_percentage ?? 0,
            resetsAt: input.rate_limits.seven_day.resets_at ?? 0
          } : void 0
        }
      };
      try {
        writeCache(cache);
      } catch (err) {
        logError("statusline:writeCache", err);
      }
    }
    const sevenDayPct = input.rate_limits?.seven_day?.used_percentage;
    const label = projectLabel(cwd);
    if (sevenDayPct === void 0) {
      process.stdout.write(label);
      return;
    }
    const acctColor = color(sevenDayPct);
    const acctStr = `${acctColor}${sevenDayPct.toFixed(0)}%/w${RESET}`;
    if (!cwd) {
      process.stdout.write(`acct: ${acctStr}`);
      return;
    }
    const verdict = checkLimit(cwd);
    if (verdict.limited && verdict.kind === "percent" && verdict.limitPercent > 0 && !verdict.cacheStale) {
      const projColor = color(verdict.usedPercent / verdict.limitPercent * 100);
      const projStr = `${projColor}${verdict.usedPercent.toFixed(1)}%${RESET} / ${verdict.limitPercent}%`;
      process.stdout.write(`${label}: ${projStr} | acct: ${acctStr}`);
    } else if (verdict.limited && verdict.kind === "usd" && verdict.limitUsd > 0) {
      const projColor = color(verdict.usedUsd / verdict.limitUsd * 100);
      const projStr = `${projColor}$${verdict.usedUsd.toFixed(2)}${RESET} / $${verdict.limitUsd.toFixed(2)}`;
      process.stdout.write(`${label}: ${projStr} | acct: ${acctStr}`);
    } else {
      process.stdout.write(`${label} | acct: ${acctStr}`);
    }
  } catch (err) {
    logError("statusline", err);
  }
}
void main();
export {
  main
};

#!/usr/bin/env node

// src/lib/config.ts
import { readFileSync } from "node:fs";

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

// src/lib/config.ts
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
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const json = JSON.parse(raw);
  return parseConfig(json);
}

// src/lib/cache.ts
import { mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
function readCache() {
  let raw;
  try {
    raw = readFileSync2(CACHE_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw);
}

// src/lib/scan.ts
import { readdirSync, readFileSync as readFileSync3, statSync } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/errors.ts
import { appendFileSync, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname } from "node:path";
function logError(context, err) {
  try {
    mkdirSync2(dirname(ERRORS_LOG_PATH), { recursive: true });
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

// src/commands/status.ts
var RESET = "\x1B[0m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var RED = "\x1B[31m";
var BOLD = "\x1B[1m";
var DIM = "\x1B[2m";
var SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
function color(pct) {
  if (pct >= 95) return RED;
  if (pct >= 80) return YELLOW;
  return GREEN;
}
function formatResetsIn(resetsAt, now) {
  const diff = resetsAt - now;
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor(diff % 86400 / 3600);
  return `${d}d ${h}h`;
}
function formatIso(epoch) {
  return new Date(epoch * 1e3).toISOString().replace("T", " ").slice(0, 16);
}
function main() {
  try {
    const config = loadConfig();
    const cache = readCache();
    const now = Math.floor(Date.now() / 1e3);
    const out = [];
    out.push(`${BOLD}Claude Usage Limiter \u2014 weekly status${RESET}`);
    const sevenDay = cache?.rateLimits.sevenDay;
    if (sevenDay) {
      const c = color(sevenDay.usedPercentage);
      out.push(
        `Account: ${c}${sevenDay.usedPercentage.toFixed(1)}%${RESET} / 100%   resets ${formatIso(sevenDay.resetsAt)} (${formatResetsIn(sevenDay.resetsAt, now)})`
      );
    } else {
      out.push(`Account: ${DIM}(no rate_limits cached \u2014 open Claude Code to refresh)${RESET}`);
    }
    const windowStart = sevenDay?.resetsAt ? sevenDay.resetsAt - SEVEN_DAYS_SEC : now - SEVEN_DAYS_SEC;
    const { total, perProject } = scanAllProjectsUsage(windowStart);
    if (!config || Object.keys(config.projects).length === 0) {
      out.push("");
      out.push(`${DIM}No projects configured. Edit ~/.claude/usage-limiter/config.json to add limits.${RESET}`);
    } else {
      const accountPct = sevenDay?.usedPercentage ?? 0;
      out.push("");
      out.push(`${BOLD}Projects:${RESET}`);
      for (const [cwd, limit] of Object.entries(config.projects)) {
        const encoded = encodeCwd(cwd);
        const proj = perProject[encoded] ?? { tokens: 0, costUsd: 0, messages: 0 };
        out.push(`  ${cwd}`);
        if (limit.weeklyBudgetUSD !== void 0) {
          const limitUsd = limit.weeklyBudgetUSD;
          const ratioPct = limitUsd > 0 ? proj.costUsd / limitUsd * 100 : 0;
          const c = color(ratioPct);
          out.push(
            `    ${c}$${proj.costUsd.toFixed(2)} / $${limitUsd.toFixed(2)}${RESET}   (${proj.messages} assistant messages)`
          );
        } else if (limit.weeklyPercent !== void 0) {
          const limitPct = limit.weeklyPercent;
          const pct = total.tokens > 0 && accountPct > 0 ? accountPct * (proj.tokens / total.tokens) : 0;
          const c = limitPct > 0 ? color(pct / limitPct * 100) : DIM;
          out.push(
            `    ${c}${pct.toFixed(1)}% / ${limitPct}%${RESET}   ($${proj.costUsd.toFixed(2)}, ${proj.messages} assistant messages)`
          );
        }
      }
    }
    process.stdout.write(out.join("\n") + "\n");
  } catch (err) {
    logError("commands:status", err);
    process.stdout.write("usage-limiter: failed to compute status \u2014 see ~/.claude/usage-limiter/errors.log\n");
  }
}
main();
export {
  main
};

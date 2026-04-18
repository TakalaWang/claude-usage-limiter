#!/usr/bin/env node

// src/commands/set.ts
import {
  copyFileSync,
  existsSync,
  mkdirSync as mkdirSync2,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { realpathSync } from "node:fs";
import { basename, dirname as dirname2 } from "node:path";

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

// src/lib/errors.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function logError(context, err) {
  try {
    mkdirSync(dirname(ERRORS_LOG_PATH), { recursive: true });
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${context}: ${err instanceof Error ? err.stack ?? err.message : String(err)}
`;
    appendFileSync(ERRORS_LOG_PATH, line);
  } catch {
  }
}

// src/commands/set.ts
function parseArg(raw) {
  const t = raw.trim();
  if (!t) throw new Error("argument required \u2014 pass e.g. 20% or $50");
  const dollar = /^\$\s*([0-9]+(?:\.[0-9]+)?)$/.exec(t);
  if (dollar) return { kind: "usd", value: Number(dollar[1]) };
  const suffixUsd = /^([0-9]+(?:\.[0-9]+)?)\s*usd$/i.exec(t);
  if (suffixUsd) return { kind: "usd", value: Number(suffixUsd[1]) };
  const pct = /^([0-9]+(?:\.[0-9]+)?)\s*%$/.exec(t);
  if (pct) return { kind: "percent", value: Number(pct[1]) };
  throw new Error(
    `invalid value "${raw}" \u2014 use 20% for percent or $50 / 50usd for dollars`
  );
}
function resolveCwd() {
  const cwd = process.cwd();
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}
function loadOrEmpty() {
  if (!existsSync(CONFIG_PATH)) {
    return { config: { version: 1, projects: {} }, existed: false };
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const json = JSON.parse(raw);
  return { config: parseConfig(json), existed: true };
}
function writeConfigAtomic(config) {
  mkdirSync2(dirname2(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, CONFIG_PATH);
}
function formatLimit(l) {
  if (!l) return "(none)";
  if (l.weeklyPercent !== void 0) return `${l.weeklyPercent}%`;
  if (l.weeklyBudgetUSD !== void 0) return `$${l.weeklyBudgetUSD.toFixed(2)}`;
  return "(none)";
}
function formatNew(arg) {
  return arg.kind === "percent" ? `${arg.value}%` : `$${arg.value.toFixed(2)}`;
}
function applyChange(config, cwd, arg) {
  if (arg.kind === "percent" && (arg.value <= 0 || arg.value > 100)) {
    throw new Error(`weeklyPercent must be in (0, 100] \u2014 got ${arg.value}`);
  }
  if (arg.kind === "usd" && arg.value <= 0) {
    throw new Error(`weeklyBudgetUSD must be > 0 \u2014 got ${arg.value}`);
  }
  const prev = config.projects[cwd];
  const next = {
    version: 1,
    projects: { ...config.projects }
  };
  if (arg.kind === "percent") {
    next.projects[cwd] = { weeklyPercent: arg.value };
  } else {
    next.projects[cwd] = { weeklyBudgetUSD: arg.value };
  }
  return { next, prev };
}
function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      process.stdout.write(
        "usage: /usage-limiter:set <value>\n  e.g.  /usage-limiter:set 20%\n        /usage-limiter:set $50\n        /usage-limiter:set 50usd\n"
      );
      process.exitCode = 1;
      return;
    }
    const arg = parseArg(args.join(" "));
    const cwd = resolveCwd();
    const { config, existed } = loadOrEmpty();
    const { next, prev } = applyChange(config, cwd, arg);
    parseConfig(next);
    if (existed) {
      const backup = `${CONFIG_PATH}.bak-${Math.floor(Date.now() / 1e3)}`;
      copyFileSync(CONFIG_PATH, backup);
    }
    writeConfigAtomic(next);
    const label = basename(cwd);
    const before = formatLimit(prev);
    const after = formatNew(arg);
    process.stdout.write(`\u2705 ${label} \u9031\u4E0A\u9650 ${before} \u2192 ${after}
`);
  } catch (err) {
    logError("commands:set", err);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`usage-limiter:set failed: ${msg}
`);
    process.exitCode = 1;
  }
}
if (process.env.USAGE_SET_NO_AUTORUN !== "1") {
  main();
}
export {
  applyChange,
  main,
  parseArg
};

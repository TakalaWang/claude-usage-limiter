// /usage-limiter:set <percent|usd> — update the current project's weekly cap.
//
// Accepts "20%" (percent) or "$50" / "50usd" (dollar budget).
// Rewrites ~/.claude/usage-limiter/config.json atomically, backing up the
// previous file to config.json.bak-<epoch>. If the config doesn't exist, creates
// one. Rejects invalid values with a clear error.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseConfig, type ProjectLimit, type UsageLimiterConfig } from "../lib/config.js";
import { CONFIG_PATH } from "../lib/paths.js";
import { logError } from "../lib/errors.js";

// Parsed user input.
type ParsedArg =
  | { kind: "percent"; value: number }
  | { kind: "usd"; value: number };

export function parseArg(raw: string): ParsedArg {
  const t = raw.trim();
  if (!t) throw new Error("argument required — pass e.g. 20% or $50");
  // "$50", "$50.25"
  const dollar = /^\$\s*([0-9]+(?:\.[0-9]+)?)$/.exec(t);
  if (dollar) return { kind: "usd", value: Number(dollar[1]) };
  // "50usd", "50USD"
  const suffixUsd = /^([0-9]+(?:\.[0-9]+)?)\s*usd$/i.exec(t);
  if (suffixUsd) return { kind: "usd", value: Number(suffixUsd[1]) };
  // "20%", "20.5%"
  const pct = /^([0-9]+(?:\.[0-9]+)?)\s*%$/.exec(t);
  if (pct) return { kind: "percent", value: Number(pct[1]) };
  throw new Error(
    `invalid value "${raw}" — use 20% for percent or $50 / 50usd for dollars`,
  );
}

function resolveCwd(): string {
  const cwd = process.cwd();
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

function loadOrEmpty(): { config: UsageLimiterConfig; existed: boolean } {
  if (!existsSync(CONFIG_PATH)) {
    return { config: { version: 1, projects: {} }, existed: false };
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const json: unknown = JSON.parse(raw);
  return { config: parseConfig(json), existed: true };
}

function writeConfigAtomic(config: UsageLimiterConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, CONFIG_PATH);
}

function formatLimit(l: ProjectLimit | undefined): string {
  if (!l) return "(none)";
  if (l.weeklyPercent !== undefined) return `${l.weeklyPercent}%`;
  if (l.weeklyBudgetUSD !== undefined) return `$${l.weeklyBudgetUSD.toFixed(2)}`;
  return "(none)";
}

function formatNew(arg: ParsedArg): string {
  return arg.kind === "percent" ? `${arg.value}%` : `$${arg.value.toFixed(2)}`;
}

// Exposed for tests.
export function applyChange(
  config: UsageLimiterConfig,
  cwd: string,
  arg: ParsedArg,
): { next: UsageLimiterConfig; prev: ProjectLimit | undefined } {
  if (arg.kind === "percent" && (arg.value <= 0 || arg.value > 100)) {
    throw new Error(`weeklyPercent must be in (0, 100] — got ${arg.value}`);
  }
  if (arg.kind === "usd" && arg.value <= 0) {
    throw new Error(`weeklyBudgetUSD must be > 0 — got ${arg.value}`);
  }
  const prev = config.projects[cwd];
  const next: UsageLimiterConfig = {
    version: 1,
    projects: { ...config.projects },
  };
  if (arg.kind === "percent") {
    next.projects[cwd] = { weeklyPercent: arg.value };
  } else {
    next.projects[cwd] = { weeklyBudgetUSD: arg.value };
  }
  return { next, prev };
}

export function main(): void {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      process.stdout.write(
        "usage: /usage-limiter:set <value>\n  e.g.  /usage-limiter:set 20%\n        /usage-limiter:set $50\n        /usage-limiter:set 50usd\n",
      );
      process.exitCode = 1;
      return;
    }
    const arg = parseArg(args.join(" "));
    const cwd = resolveCwd();
    const { config, existed } = loadOrEmpty();

    // Validate arg by running full parseConfig over the prospective next-state
    // (catches edge cases like both-fields if we ever change applyChange).
    const { next, prev } = applyChange(config, cwd, arg);
    parseConfig(next);

    if (existed) {
      const backup = `${CONFIG_PATH}.bak-${Math.floor(Date.now() / 1000)}`;
      copyFileSync(CONFIG_PATH, backup);
    }
    writeConfigAtomic(next);

    const label = basename(cwd);
    const before = formatLimit(prev);
    const after = formatNew(arg);
    process.stdout.write(`✅ ${label} 週上限 ${before} → ${after}\n`);
  } catch (err) {
    logError("commands:set", err);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`usage-limiter:set failed: ${msg}\n`);
    process.exitCode = 1;
  }
}

// Don't auto-run when imported by tests.
if (process.env.USAGE_SET_NO_AUTORUN !== "1") {
  main();
}

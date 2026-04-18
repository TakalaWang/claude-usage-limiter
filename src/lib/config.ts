// Load and validate ~/.claude/usage-limiter/config.json.
// v0.2: each project picks EXACTLY ONE of weeklyPercent / weeklyBudgetUSD.
import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./paths.js";

export interface ProjectLimit {
  weeklyPercent?: number;
  weeklyBudgetUSD?: number;
}

export interface UsageLimiterConfig {
  version: 1;
  projects: Record<string, ProjectLimit>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseConfig(raw: unknown): UsageLimiterConfig {
  if (!isRecord(raw)) throw new Error("config: root must be an object");
  if (raw.version !== 1) throw new Error("config: version must be 1");
  if (!isRecord(raw.projects)) throw new Error("config: projects must be an object");

  const projects: Record<string, ProjectLimit> = {};
  for (const [key, value] of Object.entries(raw.projects)) {
    if (!isRecord(value)) throw new Error(`config: projects[${key}] must be an object`);

    const hasPct = value.weeklyPercent !== undefined;
    const hasUsd = value.weeklyBudgetUSD !== undefined;
    if (hasPct && hasUsd) {
      throw new Error(
        `config: projects[${key}] sets both weeklyPercent and weeklyBudgetUSD — choose one`,
      );
    }

    const limit: ProjectLimit = {};
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
      // Neither set — project effectively unlimited, skip.
      continue;
    }
    projects[key] = limit;
  }
  return { version: 1, projects };
}

export function loadConfig(): UsageLimiterConfig | null {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json: unknown = JSON.parse(raw);
  return parseConfig(json);
}

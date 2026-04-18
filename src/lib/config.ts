// Load and validate ~/.claude/usage-limiter/config.json.
// v0.1 supports weeklyPercent only.
import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./paths.js";

export interface ProjectLimit {
  weeklyPercent?: number;
  // weeklyBudgetUSD reserved for v0.2
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
    const limit: ProjectLimit = {};
    if (value.weeklyPercent !== undefined) {
      if (typeof value.weeklyPercent !== "number" || !isFinite(value.weeklyPercent)) {
        throw new Error(`config: projects[${key}].weeklyPercent must be a number`);
      }
      if (value.weeklyPercent <= 0 || value.weeklyPercent > 100) {
        throw new Error(`config: projects[${key}].weeklyPercent must be in (0, 100]`);
      }
      limit.weeklyPercent = value.weeklyPercent;
    }
    if (limit.weeklyPercent === undefined) {
      // v0.1: no weeklyBudgetUSD support, skip unknown projects rather than error.
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

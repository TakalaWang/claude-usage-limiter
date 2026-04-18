// Load, validate, and write ~/.claude/usage-limiter/config.json.
// Stub — implementation pending.

export interface ProjectLimit {
  weeklyPercent?: number;
  weeklyBudgetUSD?: number;
}

export interface UsageLimiterConfig {
  version: 1;
  projects: Record<string, ProjectLimit>;
}

export function loadConfig(): UsageLimiterConfig | null {
  return null;
}

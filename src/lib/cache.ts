// Atomic read/write of ~/.claude/usage-limiter/cache.json.
// Populated by statusline; read by hooks.
// Stub — implementation pending.

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
  return null;
}

export function writeCache(_cache: UsageCache): void {
  // pending
}

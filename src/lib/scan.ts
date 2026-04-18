// Scan ~/.claude/projects/<encoded-cwd>/*.jsonl and aggregate token usage
// since the current seven_day.resets_at window start.
// Stub — implementation pending.

export interface ProjectUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  usdCost: number;
}

export function scanProjectUsage(_cwd: string, _windowStartEpoch: number): ProjectUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usdCost: 0,
  };
}

// Core check: given a cwd, decide whether this project is over its configured limit.
// Stub — implementation pending.

export type LimitVerdict =
  | { limited: false }
  | { limited: true; exceeded: false; currentPercent: number; limitPercent: number }
  | { limited: true; exceeded: true; reason: string };

export function checkLimit(_cwd: string): LimitVerdict {
  return { limited: false };
}

// Scan ~/.claude/projects/<encoded-cwd>/*.jsonl and aggregate token usage + USD cost
// since the current seven_day.resets_at window start.
// v0.2: still exports full-scan functions. Incremental caching layered on in scan-cache.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_DIR, encodeCwd } from "./paths.js";
import { costUsdFor, type UsageBlock } from "./pricing.js";

export interface ProjectUsage {
  tokens: number; // input + output + cache_creation + cache_read
  costUsd: number; // USD across all assistant messages in-window
  messages: number;
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  message?: { usage?: UsageBlock; model?: string };
}

function usageTokens(u: UsageBlock | undefined): number {
  if (!u) return 0;
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0)
  );
}

function listJsonl(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Parse a single JSONL line and update the accumulator if it's an in-window assistant message.
// Exported for reuse by scan-cache.ts.
export function accumulateLine(
  line: string,
  sinceEpochMs: number,
  acc: ProjectUsage,
): void {
  if (!line) return;
  let parsed: JsonlLine;
  try {
    parsed = JSON.parse(line) as JsonlLine;
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

function scanFile(path: string, sinceEpochMs: number, acc: ProjectUsage): void {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) accumulateLine(line, sinceEpochMs, acc);
}

// Scan usage for one project since windowStartEpoch (unix seconds).
export function scanProjectUsage(cwd: string, windowStartEpoch: number): ProjectUsage {
  const dir = join(PROJECTS_DIR, encodeCwd(cwd));
  const acc: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
  const sinceMs = windowStartEpoch * 1000;
  for (const f of listJsonl(dir)) scanFile(f, sinceMs, acc);
  return acc;
}

// Sum usage across EVERY project dir under ~/.claude/projects (account total).
export function scanAllProjectsUsage(windowStartEpoch: number): {
  total: ProjectUsage;
  perProject: Record<string, ProjectUsage>;
} {
  const total: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
  const perProject: Record<string, ProjectUsage> = {};
  const sinceMs = windowStartEpoch * 1000;

  let entries: string[];
  try {
    entries = readdirSync(PROJECTS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { total, perProject };
    }
    throw err;
  }

  for (const name of entries) {
    const sub = join(PROJECTS_DIR, name);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const acc: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
    for (const f of listJsonl(sub)) scanFile(f, sinceMs, acc);
    perProject[name] = acc;
    total.tokens += acc.tokens;
    total.costUsd += acc.costUsd;
    total.messages += acc.messages;
  }
  return { total, perProject };
}

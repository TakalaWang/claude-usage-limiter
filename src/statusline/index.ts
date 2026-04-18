// Statusline: reads JSON from stdin, writes cache.json if rate_limits present,
// prints a colored one-liner. Must never crash.
import { basename } from "node:path";
import { writeCache, type UsageCache } from "../lib/cache.js";
import { checkLimit } from "../lib/check-limit.js";
import { logError } from "../lib/errors.js";

interface StatuslineInput {
  cwd?: string;
  workspace?: { current_dir?: string };
  session_id?: string;
  model?: { display_name?: string };
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function color(pct: number): string {
  if (pct >= 95) return RED;
  if (pct >= 80) return YELLOW;
  return GREEN;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function projectLabel(cwd: string | undefined): string {
  if (!cwd) return "(no cwd)";
  return basename(cwd);
}

export async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    const input: StatuslineInput = raw.trim() ? (JSON.parse(raw) as StatuslineInput) : {};
    const cwd = input.workspace?.current_dir ?? input.cwd;

    // Cache rate_limits when present.
    if (input.rate_limits) {
      const cache: UsageCache = {
        updatedAt: Math.floor(Date.now() / 1000),
        rateLimits: {
          fiveHour: input.rate_limits.five_hour
            ? {
                usedPercentage: input.rate_limits.five_hour.used_percentage ?? 0,
                resetsAt: input.rate_limits.five_hour.resets_at ?? 0,
              }
            : undefined,
          sevenDay: input.rate_limits.seven_day
            ? {
                usedPercentage: input.rate_limits.seven_day.used_percentage ?? 0,
                resetsAt: input.rate_limits.seven_day.resets_at ?? 0,
              }
            : undefined,
        },
      };
      try {
        writeCache(cache);
      } catch (err) {
        logError("statusline:writeCache", err);
      }
    }

    const sevenDayPct = input.rate_limits?.seven_day?.used_percentage;
    const label = projectLabel(cwd);

    if (sevenDayPct === undefined) {
      // No rate_limits — session label only, no colors.
      process.stdout.write(label);
      return;
    }

    const acctColor = color(sevenDayPct);
    const acctStr = `${acctColor}${sevenDayPct.toFixed(0)}%/w${RESET}`;

    if (!cwd) {
      process.stdout.write(`acct: ${acctStr}`);
      return;
    }

    // Per-project usage (only meaningful if this project is configured).
    const verdict = checkLimit(cwd);
    if (verdict.limited && verdict.limitPercent > 0 && !verdict.cacheStale) {
      const projColor = color((verdict.usedPercent / verdict.limitPercent) * 100);
      const projStr = `${projColor}${verdict.usedPercent.toFixed(1)}%${RESET} / ${verdict.limitPercent}%`;
      process.stdout.write(`${label}: ${projStr} | acct: ${acctStr}`);
    } else {
      process.stdout.write(`${label} | acct: ${acctStr}`);
    }
  } catch (err) {
    logError("statusline", err);
    // Print nothing rather than crash.
  }
}

void main();

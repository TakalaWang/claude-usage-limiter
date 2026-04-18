// /usage-status — print per-project + account weekly usage.
import { loadConfig } from "../lib/config.js";
import { readCache } from "../lib/cache.js";
import { scanAllProjectsUsage } from "../lib/scan.js";
import { logError } from "../lib/errors.js";
import { encodeCwd } from "../lib/paths.js";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function color(pct: number): string {
  if (pct >= 95) return RED;
  if (pct >= 80) return YELLOW;
  return GREEN;
}

function formatResetsIn(resetsAt: number, now: number): string {
  const diff = resetsAt - now;
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return `${d}d ${h}h`;
}

function formatIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 16);
}

export function main(): void {
  try {
    const config = loadConfig();
    const cache = readCache();
    const now = Math.floor(Date.now() / 1000);

    const out: string[] = [];
    out.push(`${BOLD}Claude Usage Limiter — weekly status${RESET}`);

    const sevenDay = cache?.rateLimits.sevenDay;
    if (sevenDay) {
      const c = color(sevenDay.usedPercentage);
      out.push(
        `Account: ${c}${sevenDay.usedPercentage.toFixed(1)}%${RESET} / 100%` +
          `   resets ${formatIso(sevenDay.resetsAt)} (${formatResetsIn(sevenDay.resetsAt, now)})`,
      );
    } else {
      out.push(`Account: ${DIM}(no rate_limits cached — open Claude Code to refresh)${RESET}`);
    }

    const windowStart = sevenDay?.resetsAt ? sevenDay.resetsAt - SEVEN_DAYS_SEC : now - SEVEN_DAYS_SEC;
    const { total, perProject } = scanAllProjectsUsage(windowStart);

    if (!config || Object.keys(config.projects).length === 0) {
      out.push("");
      out.push(`${DIM}No projects configured. Edit ~/.claude/usage-limiter/config.json to add limits.${RESET}`);
    } else {
      const accountPct = sevenDay?.usedPercentage ?? 0;
      out.push("");
      out.push(`${BOLD}Projects:${RESET}`);
      for (const [cwd, limit] of Object.entries(config.projects)) {
        const encoded = encodeCwd(cwd);
        const proj = perProject[encoded] ?? { tokens: 0, costUsd: 0, messages: 0 };
        out.push(`  ${cwd}`);
        if (limit.weeklyBudgetUSD !== undefined) {
          const limitUsd = limit.weeklyBudgetUSD;
          const ratioPct = limitUsd > 0 ? (proj.costUsd / limitUsd) * 100 : 0;
          const c = color(ratioPct);
          out.push(
            `    ${c}$${proj.costUsd.toFixed(2)} / $${limitUsd.toFixed(2)}${RESET}` +
              `   (${proj.messages} assistant messages)`,
          );
        } else if (limit.weeklyPercent !== undefined) {
          const limitPct = limit.weeklyPercent;
          const pct = total.tokens > 0 && accountPct > 0
            ? accountPct * (proj.tokens / total.tokens)
            : 0;
          const c = limitPct > 0 ? color((pct / limitPct) * 100) : DIM;
          out.push(
            `    ${c}${pct.toFixed(1)}% / ${limitPct}%${RESET}` +
              `   ($${proj.costUsd.toFixed(2)}, ${proj.messages} assistant messages)`,
          );
        }
      }
    }

    process.stdout.write(out.join("\n") + "\n");
  } catch (err) {
    logError("commands:status", err);
    process.stdout.write("usage-limiter: failed to compute status — see ~/.claude/usage-limiter/errors.log\n");
  }
}

main();

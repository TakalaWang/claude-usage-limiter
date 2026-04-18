# claude-usage-limiter

A Claude Code plugin that enforces **per-project weekly usage limits**. When a
configured project exceeds its share of your weekly Claude Code quota — or a
dollar budget you picked for it — new prompts and mid-turn tool calls are
blocked until the week resets.

## Why

Claude Code's built-in weekly limit is account-wide. If you want to cap how
much of that quota a single side project can consume — "project A gets at most
20%, project B gets at most \$50/week" — this plugin does it.

## How it works

1. **Statusline** reads Claude Code's `rate_limits` payload (Pro/Max
   subscribers only) and caches the account-wide weekly usage percentage.
2. **UserPromptSubmit hook** runs before every prompt: scans
   `~/.claude/projects/<cwd>/*.jsonl` for the current project's token usage
   this week, derives this project's share of the account's weekly quota or
   its \$ cost, and blocks the turn if the configured limit is exceeded.
3. **PreToolUse hook** catches mid-turn agentic overshoot. On a "refactor the
   whole codebase" run, `UserPromptSubmit` alone won't stop a turn that goes
   over mid-flight; `PreToolUse` gates each tool call and emits
   `hookSpecificOutput.permissionDecision = "deny"` with a "DO NOT retry"
   reason so the model ends the turn cleanly after 1–3 adapt cycles.

Scans are incremental: per-file offsets live in
`~/.claude/usage-limiter/scan-cache.json`, so a heavy-user JSONL dir stays
under ~50 ms per hook even after it grows past 100 MB.

See
[`docs/plans/2026-04-19-claude-usage-limiter-design.md`](docs/plans/2026-04-19-claude-usage-limiter-design.md)
for the design rationale and
[`docs/plans/e2e-findings.md`](docs/plans/e2e-findings.md) for what the
automated smoke test covers.

## Install

```bash
/plugin install github:TakalaWang/claude-usage-limiter
```

That's it. On the next session start, a `SessionStart` hook silently
patches `~/.claude/settings.json` to wire up the statusline (with a
timestamped backup). If you already have a `statusLine` configured,
the hook leaves it alone and tells you — run
`/usage-limiter:install-statusline` to override.

## Configure

Create `~/.claude/usage-limiter/config.json`:

```json
{
  "version": 1,
  "projects": {
    "/Users/you/code/side-project": { "weeklyPercent": 20 },
    "/Users/you/code/work-repo":    { "weeklyBudgetUSD": 50 }
  }
}
```

- **Key** = the absolute path you open Claude Code at (same path shown in the
  session title).
- Each project picks **exactly one** of:
  - `weeklyPercent` — cap on this project's share of your weekly account
    quota (0 < x ≤ 100).
  - `weeklyBudgetUSD` — a hard \$ cap. Tokens are priced per model from
    `src/lib/pricing.ts` (opus / sonnet / haiku); unknown models fall back to
    Sonnet pricing.
- Setting both fields on one project is rejected with a clear error.
- Projects not listed are **unlimited** (covered only by Claude Code's global
  cap).

Projects are identified by cwd, not git root — if you open Claude Code at
different paths for the same repo, they count as different projects.

## Slash commands

- `/usage-limiter:usage-status` — show account + per-project status this week.
- `/usage-limiter:set <value>` — set the current project's cap without
  leaving Claude Code. Accepts `20%`, `$50`, or `50usd`. Writes
  `config.json` atomically and keeps a `config.json.bak-<epoch>` backup.
- `/usage-limiter:install-statusline` — patch `settings.json` with the plugin
  statusline command.

## Statusline

Shows `{project}: X% / Y% | acct: Z%/w` (or `$X.XX / $Y.YY` for USD-capped
projects) with green/yellow/red thresholds at <80 / 80–95 / ≥95.

## Requirements

- Claude Code ≥ 2.1 (for the plugin system)
- A Claude.ai Pro or Max subscription — `weeklyPercent` needs the
  `rate_limits` payload, which is only emitted for subscribers.
  `weeklyBudgetUSD` works without a subscription (project-local math).
- Node.js ≥ 20

## Develop

```
pnpm install
pnpm typecheck
pnpm test
pnpm run build
pnpm e2e
```

## License

MIT

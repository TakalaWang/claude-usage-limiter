# claude-usage-limiter

> Per-project weekly usage limits for Claude Code.

Claude Code's built-in weekly limit is account-wide. If you want to cap how
much of that quota a single side project can consume — "project A gets at most
20%, project B gets at most \$50/week" — this plugin does it. When a project
hits its cap, new prompts and mid-turn tool calls are blocked until the week
resets.

```
$ /claude-usage-limiter:status
Claude Usage Limiter — weekly status
Account: 41.2% / 100%   resets 2026-04-26 09:00 (3d 5h)

Projects:
  /Users/you/code/side-project
    12.4% / 20%   ($7.32, 58 assistant messages)
  /Users/you/code/work-repo
    $42.10 / $50.00   (311 assistant messages)
  /Users/you/code/experiments
    25.3% / 20%   ⛔ OVER   ($14.91, 102 assistant messages)
```

## Install

```
/plugin marketplace add TakalaWang/claude-usage-limiter
/plugin install claude-usage-limiter@takalawang
```

Restart Claude Code. On first session the plugin auto-patches
`~/.claude/settings.json` to wire its statusline (with a timestamped backup);
run `/claude-usage-limiter:install-statusline` manually if you'd rather
override an existing one.

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

Or from inside Claude Code:

```
/claude-usage-limiter:set 20%
/claude-usage-limiter:set $50
```

- **Key** = the absolute path you open Claude Code at.
- Each project picks **exactly one** of `weeklyPercent` *or* `weeklyBudgetUSD`.
- `weeklyPercent` = cap on this project's share of your weekly account quota.
- `weeklyBudgetUSD` = hard \$ cap (priced per model via `src/lib/pricing.ts`).
- Projects not listed are unlimited (covered only by Claude Code's global cap).
- Projects are keyed by cwd, not git root.

## Slash commands

- `/claude-usage-limiter:status` — show account + per-project status this week.
- `/claude-usage-limiter:set <value>` — set the current project's cap. Accepts `20%`, `$50`, or `50usd`.
- `/claude-usage-limiter:install-statusline` — (re)wire the plugin statusline into `settings.json`.

The three commands above are always allowed through — you can never block
yourself out of managing your own limits.

## How it works

1. **Statusline** reads Claude Code's `rate_limits` payload and writes it to
   `~/.claude/usage-limiter/cache.json` every render.
2. **UserPromptSubmit hook** runs before each prompt, scans
   `~/.claude/projects/<cwd>/*.jsonl` for this project's tokens this week,
   compares to the limit, and blocks via `{"decision":"block","reason":…}` if
   over.
3. **PreToolUse hook** catches mid-turn agentic overshoot. Emits
   `hookSpecificOutput.permissionDecision = "deny"` with a "DO NOT retry"
   reason so the model ends the turn cleanly after 1–3 adapt cycles.
4. **SessionStart hook** auto-wires the statusline into `settings.json` on
   first install and refreshes the path after plugin upgrades.

Scans are incremental — per-file offsets live in `scan-cache.json`, so a
heavy-user JSONL dir stays under ~50 ms per hook even past 100 MB.

## Statusline

Shows `{project}: X% / Y%` (or `$X.XX / $Y.YY`) with green/yellow/red at
`<80 / 80–95 / ≥95`. Blank when the current project isn't configured.

## Requirements

- Claude Code ≥ 2.1 (plugin system)
- Claude.ai Pro or Max — `weeklyPercent` needs the `rate_limits` payload, which
  is only emitted for subscribers. `weeklyBudgetUSD` works without.
- Node.js ≥ 20

## Troubleshooting

**Hooks aren't firing after install.** Plugin hooks only register on
*new* Claude Code sessions. Quit Claude Code fully and reopen.

**Statusline shows stale values / wrong reset date.** Someone populated
`cache.json` with fake data (eg. during testing). Clear it:
`rm ~/.claude/usage-limiter/cache.json` and restart Claude Code — the
statusline will repopulate on the next render.

**I hit my own limit and can't unblock.** The three
`/claude-usage-limiter:*` commands are always whitelisted. If that doesn't
work, remove the config: `rm ~/.claude/usage-limiter/config.json`.

**After upgrading the plugin, the statusline breaks.** SessionStart
auto-refreshes the path, but you need a *new* session for it to run. If
something went wrong run `/claude-usage-limiter:install-statusline` manually.

**`CLAUDE_CONFIG_DIR` is set.** The plugin respects it and uses the same
directory Claude Code uses.

## Develop

```
pnpm install
pnpm typecheck
pnpm test
pnpm run build
pnpm e2e
```

`plugin/bin/` is the distributed artifact and IS committed — marketplace
installs copy the repo as-is. Rebuild before committing source changes.

## License

MIT

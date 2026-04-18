# claude-usage-limiter

A Claude Code plugin that enforces **per-project weekly usage limits**. When a configured project exceeds its share of your weekly Claude Code quota, new prompts are blocked until the week resets.

## Why

Claude Code's built-in weekly limit is account-wide. If you want to cap how much of that quota a single side project can consume — "project A gets at most 20%, project B gets 30%" — this plugin does it.

## How it works

1. **Statusline** reads Claude Code's `rate_limits` payload (Pro/Max subscribers only) and caches the account-wide weekly usage percentage.
2. **UserPromptSubmit hook** runs before every prompt: scans `~/.claude/projects/<cwd>/*.jsonl` for the current project's token usage this week, derives the project's share of the account's weekly quota, blocks if the configured limit is exceeded.
3. **PreToolUse hook** (v0.2 — currently a no-op) will catch mid-turn agentic overshoot.

See [`docs/plans/2026-04-19-claude-usage-limiter-design.md`](docs/plans/2026-04-19-claude-usage-limiter-design.md) for the full design rationale.

## Install

```bash
/plugin install github:TakalaWang/claude-usage-limiter
```

Then wire up the statusline (plugins cannot auto-install statuslines):

```
/usage-limiter:install-statusline
```

This patches `~/.claude/settings.json` (with a timestamped backup).

## Configure

Create `~/.claude/usage-limiter/config.json`:

```json
{
  "version": 1,
  "projects": {
    "/Users/you/code/side-project": { "weeklyPercent": 20 },
    "/Users/you/code/work-repo":    { "weeklyPercent": 50 }
  }
}
```

- **Key** = the absolute path you open Claude Code at (same path shown in the session title).
- `weeklyPercent` = cap on this project's share of your weekly account quota.
- Projects not listed are **unlimited** (covered only by Claude Code's global cap).

Projects are identified by cwd, not git root — if you open Claude Code at different paths for the same repo, they count as different projects.

## Usage

Check status inside Claude Code:

```
/usage-limiter:usage-status
```

Statusline shows `{project}: X% / Y% | acct: Z%/w` with green/yellow/red thresholds.

## Requirements

- Claude Code ≥ 2.1 (for the plugin system)
- A Claude.ai Pro or Max subscription (the `rate_limits` payload is only emitted for subscribers)
- Node.js ≥ 20

## Status

**v0.1 MVP.** Supports `weeklyPercent` with hard enforcement via `UserPromptSubmit`. See [issues](https://github.com/TakalaWang/claude-usage-limiter/issues) for the v0.2 roadmap.

## License

MIT

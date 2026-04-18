# E2E Findings — 2026-04-18

`scripts/e2e.mjs` is a non-interactive smoke test. It boots a throwaway HOME
dir, fabricates the config + cache + JSONL needed to guarantee an overshoot,
and pipes realistic hook/statusline stdin payloads into the built `bin/` entry
points.

## What the script validates

| Check | Assertion |
|---|---|
| Build output exists | All three entry points present under `bin/` |
| UserPromptSubmit blocks | `bin/hooks/user-prompt-submit.js` exits 0 and emits `{"decision":"block","reason":...}` with reason mentioning the overshoot |
| PreToolUse denies | `bin/hooks/pre-tool-use.js` exits 0 and emits `hookSpecificOutput.hookEventName=PreToolUse` + `permissionDecision=deny` + `permissionDecisionReason` containing "DO NOT retry" |
| Statusline renders | `bin/statusline.js` exits 0, output contains the project name, `X% / Y%`, and `acct: N%/w` (ANSI colors stripped before matching) |

All assertions run against the real bundled JS — the same code Claude Code
would execute in a live session. Failures leave the sandbox in `/tmp` for
post-mortem.

## What still requires manual verification in a real Claude Code session

The script can't exercise two behaviours that only emerge from the Claude Code
runtime itself:

1. **PreToolUse soft-block recovery cadence.** Docs say the model sees a
   `permissionDecision: "deny"` as a tool error, usually adapts after 1–3
   retries, and ends the turn. We assert the hook emits the right shape; we
   can't confirm the model's adapt-and-stop behaviour without a live session.
   To verify: set `weeklyPercent: 0.001` on a real project, ask Claude to do
   something tool-heavy (e.g. "read every file in the repo"), confirm it hits
   1–3 denied tool calls, then ends the turn cleanly. Measure overshoot in
   tokens via `~/.claude/projects/<cwd>/*.jsonl`.

2. **Statusline trigger cadence.** The design assumes the statusline re-renders
   often enough to keep `cache.json` fresher than the 10-minute staleness
   window. Our script just confirms the statusline runs when invoked. To
   verify cadence: tail `~/.claude/usage-limiter/cache.json`'s `updatedAt`
   during a 5-minute idle → active → idle cycle and confirm the gaps stay
   under 10 min under normal usage.

3. **`rate_limits` payload presence.** The statusline only caches anything
   useful when Claude Code has actually received a `rate_limits` block from
   the API (Pro/Max subscribers, after the first response). The script
   fabricates one; a real session may lag. Not a correctness issue — the
   "cache stale → allow + warn" path already handles this — but worth eyeing
   during a real install.

4. **`${CLAUDE_PLUGIN_ROOT}` expansion in `plugin.json`.** Works in our smoke
   test because we invoke the `bin/*` scripts directly with absolute paths.
   Confirmed in `docs/plans/smoke-test-findings.md` that the plugin loader
   substitutes the variable inside hook commands, but a real plugin-install
   run is still the definitive verification.

## How to run

```
pnpm run build && pnpm e2e
```

Exits 0 on success. On failure the sandbox (`/tmp/claude-test-*`) is kept
so you can inspect the fabricated `config.json` / `cache.json` / JSONL.

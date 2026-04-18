# Claude Usage Limiter — Design

**Date:** 2026-04-19
**Status:** Design approved, pending implementation plan

## Goal

A Claude Code plugin that enforces **per-project weekly usage limits** (e.g. 專案 A ≤ 20% of weekly quota, 專案 B ≤ $50/week). Hard stop when exceeded.

## Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| Q1 | Weekly usage limit % as primary unit, optional $ budget | Matches Claude Code's own quota model |
| Q2 | Hard stop (block via hook) | User wants enforcement, not just warnings |
| Q5 | Statusline writes rate_limits cache; hooks read cache | Avoids needing OAuth token from hooks |
| Q6 | Strict mode: `UserPromptSubmit` + `PreToolUse` | Covers new turns + agentic overshoot |
| Q7 | Claude Code Plugin | Native distribution, `/plugin install` |
| Q8 | Per-project limit only, `weeklyPercent` OR `weeklyBudgetUSD` | Global cap already handled by Claude Code |
| Q9 | cwd (Claude Code's opening directory) as project key | Aligns with Claude Code's own `~/.claude/projects/` bucketing |
| Q10 | TypeScript / Node.js | Fits user's stack; easy to distribute |
| Q11 | `/usage-status` + `/usage-set` slash commands | Visibility + convenience; edit config directly for hard changes |
| Q12 | Colored statusline: project %, account %, $ this week | At-a-glance feedback with warning colors |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code runtime                      │
└───┬──────────┬──────────┬────────────────┬──────────────────┘
    │          │          │                │
    ▼          ▼          ▼                ▼
 statusline  UserPrompt  PreToolUse    Slash cmds
  (寫 cache)   Submit     (每 tool 前)  (/usage-status
                (每 turn 前)              /usage-set)
     │           │           │                │
     └───────────┴───┬───────┴────────────────┘
                    ▼
         ┌──────────────────────┐
         │   CUL 核心 library   │
         │  • 讀 cache          │
         │  • scan JSONLs       │
         │  • 判斷是否超標       │
         │  • 寫設定檔            │
         └─┬────────────────┬───┘
           │                │
           ▼                ▼
  ~/.claude/usage-   ~/.claude/
  limiter/cache.json  usage-limiter/
  ・rate_limits       config.json
  ・updated_at        ・per-project limits
```

**Data sources:**
- Project token usage → scan `~/.claude/projects/<encoded-cwd>/*.jsonl`
- Account weekly % → `cache.json` (populated by statusline)
- Weekly window boundary → `cache.json`'s `seven_day.resets_at`

**Why `UserPromptSubmit` + `PreToolUse` together:**

Claude Code has no `PreApiCall` hook. API calls happen at two moments:
1. Turn start — gated by `UserPromptSubmit` (hard block, 0 tokens)
2. Tool-driven continuations — gated by `PreToolUse` (soft block, ~1–3K tokens overshoot as model adapts)

`UserPromptSubmit` alone misses agentic overshoot. `PreToolUse` alone misses pure-text responses (which fire no tool hooks). Together they cover all API-call entry points.

## Config Schema

**Location:** `~/.claude/usage-limiter/config.json`

```json
{
  "version": 1,
  "projects": {
    "/Users/takala/code/escape-group": {
      "weeklyPercent": 20
    },
    "/Users/takala/code/gitroll-ai-analyzer": {
      "weeklyBudgetUSD": 50
    }
  }
}
```

**Rules:**
- Key = cwd (absolute path, `realpath()` for symlink normalization)
- Each project picks **exactly one** of `weeklyPercent` or `weeklyBudgetUSD`
- Projects not listed = unlimited (fall through to Claude Code's global cap)

**Project resolution:**
```
1. cwd → realpath()
2. lookup config.projects[realpath]
3. miss → { limited: false }
4. hit  → { limited: true, limit: ... }
```

## Cache Schema

**Location:** `~/.claude/usage-limiter/cache.json`

```json
{
  "updatedAt": 1744992000,
  "rateLimits": {
    "fiveHour": { "usedPercentage": 45, "resetsAt": 1744996800 },
    "sevenDay": { "usedPercentage": 20, "resetsAt": 1745596800 }
  }
}
```

Written by statusline on every render (atomic via tempfile + rename). Read by hooks.

## Token Aggregation

```
projectWeeklyTokens =
  sum(assistant message usage)
  from  ~/.claude/projects/<encodedCwd>/*.jsonl
  where timestamp > (sevenDay.resetsAt - 7d)
```

Encoding: `/Users/takala/code/escape-group` → `-Users-takala-code-escape-group` (slashes → dashes).

`usage` = `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
`$` conversion via per-model pricing table in `lib/pricing.ts`.

## Hook Behaviour

**`UserPromptSubmit`:**
```
1. Read cwd from payload → resolveProject()
2. Not in config → exit 0
3. Read cache; if updatedAt > 10 min old → warn but allow
4. Compute this-week project usage (% or $)
5. Exceeded → return { decision: "block", reason: "..." }
```

Block reason example:
```
🛑 Project escape-group exceeded its 20% weekly budget (current 21.3%).
Resets at 2026-04-26 09:00 (in 3d 12h).
To adjust: edit ~/.claude/usage-limiter/config.json
```

**`PreToolUse`:** same logic, plus:
- Throttle: skip if last check < 2 seconds ago in same session
- Block reason explicitly tells the model "DO NOT retry, you are over budget" to minimise soft-block overshoot

**Error policy:** any unexpected exception → exit 0 (allow) + append to `errors.log`. Tool bugs must never block user work.

## Statusline Output

```
A: 45%/100% | 帳號: 60%/w | ~$12.3/week
```

Colors:
- <80%: green
- 80–95%: yellow
- ≥95%: red
- 100%: red background, blink

Falls back to `$ only` when `rate_limits` field absent (e.g. non-subscriber).

## Slash Commands

**`/usage-status`** — print per-project + account status:
```
📊 Claude Usage Limiter — 本週狀態
Reset: 2026-04-26 09:00（剩 3 天 5 小時）

當前專案: escape-group
  用量: 12.4% / 20%（$7.32）  🟢

其他受限專案:
  gitroll-ai-analyzer:  $18.50 / $50      🟢
  mentora:              8.1% / 10%        🟡

帳號週總用量: 42% 🟢
```

**`/usage-set <percent|usd>`** — interactive update of the current project's limit.

## Repo Layout

```
claude-usage-limiter/
├── plugin.json
├── package.json
├── tsconfig.json
├── src/
│   ├── lib/
│   │   ├── config.ts         # load/validate config.json
│   │   ├── cache.ts          # atomic cache I/O
│   │   ├── pricing.ts        # per-model USD/token
│   │   ├── scan.ts           # JSONL incremental scan
│   │   └── check-limit.ts    # core overshoot check
│   ├── statusline/index.ts
│   ├── hooks/
│   │   ├── user-prompt-submit.ts
│   │   └── pre-tool-use.ts
│   └── commands/
│       ├── status.ts
│       └── set.ts
├── commands/
│   ├── usage-status.md
│   └── usage-set.md
├── bin/                       # build output (bundled single-file js)
├── test/
└── README.md
```

## Edge Cases

| Case | Behaviour |
|---|---|
| Cache missing / stale (>10 min) | Allow + warn |
| Config malformed / missing | Allow + warn |
| Non-subscriber (no `rate_limits`) | `$` limits still work; `%` limits degrade to warning |
| Project path missing on disk | String-match fallback + log warning |
| Hook script crash | Exit 0 (allow) + append to `errors.log` |
| Multi-machine config sync | Out of scope for v0.1 (dotfiles/symlink) |

## Known Risks To Verify Before Coding

| Risk | Severity | Verification |
|---|---|---|
| Hook `{"decision":"block"}` behaviour vs exit 2 | High | Build minimal hook, measure |
| Statusline trigger frequency enough to keep cache fresh | Medium | Log timestamps for 1 day |
| When `rate_limits` field is absent | Medium | Test with new session |
| `${PLUGIN_DIR}` substitution support | Medium | Check docs / dry install |
| JSONL scan perf on large dirs | Low | Incremental cache handles it |

## MVP (v0.1)

- ✅ `weeklyPercent` config
- ✅ `UserPromptSubmit` hook
- ✅ Statusline
- ✅ `/usage-status` command
- ❌ `weeklyBudgetUSD` — v0.2
- ❌ `PreToolUse` hook — v0.2
- ❌ `/usage-set` command — v0.2
- ❌ Incremental JSONL scan — v0.2 (v0.1 full-scan with in-memory cache per run)

Target: ~500–800 LoC TypeScript, one weekend.

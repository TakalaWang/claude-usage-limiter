# Smoke Test Findings — 2026-04-18

Verification of the five high-risk assumptions in `2026-04-19-claude-usage-limiter-design.md`
before writing any business logic.

Sources used:
- Claude Code binary (Mach-O) at `/Users/takala/.local/share/claude/versions/2.1.114`
- Official docs (all redirect `docs.claude.com/en/docs/claude-code/*` → `code.claude.com/docs/en/*`):
  - `/plugins`, `/plugins-reference`, `/hooks`, `/statusline`, `/settings`

---

## 1. Plugin manifest schema — WRONG

**Assumption:** `plugin.json` at plugin root with top-level `statusLine`, `hooks.UserPromptSubmit`, `hooks.PreToolUse`, `commands` array.

**Actual:**

- Manifest lives at **`.claude-plugin/plugin.json`**, not at the repo root.
- Top-level keys that ARE supported: `name`, `version`, `description`, `author`, `homepage`,
  `repository`, `license`, `keywords`, `skills`, `commands`, `agents`, `hooks`, `mcpServers`,
  `outputStyles`, `lspServers`, `monitors`, `userConfig`, `channels`, `dependencies`.
- `statusLine` is **NOT** a plugin.json key. See assumption 6 below.
- `hooks` inside plugin.json is either a **path string** (default `./hooks/hooks.json`) or an
  **inline object** whose shape matches user settings:
  ```json
  {
    "hooks": {
      "UserPromptSubmit": [
        {
          "hooks": [
            { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/user-prompt-submit.js" }
          ]
        }
      ],
      "PreToolUse": [
        {
          "matcher": "Write|Edit|Bash",
          "hooks": [
            { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/pre-tool-use.js" }
          ]
        }
      ]
    }
  }
  ```
  Hook event names in the design (`UserPromptSubmit`, `PreToolUse`) ARE valid and case-sensitive.
- `commands` is NOT an array of `{name, description, path}` objects. It is a path string or array
  of paths to either directories or flat `.md` files. Default location is `commands/*.md`
  (just markdown slash-command files; no registration in plugin.json needed).

**Impact on design:**
- Move `plugin.json` → `.claude-plugin/plugin.json`.
- Remove `statusLine` from plugin.json.
- Put hooks either inline or at `hooks/hooks.json`. Choosing inline (simpler, one file).
- `/usage-status` slash command = just a `commands/usage-status.md` file; no registration.

---

## 1b. Statusline distribution — ⚠️ DIFFERENT THAN EXPECTED (high impact)

**Finding from `/settings` and `/plugins-reference`:**

> Plugins can include a `settings.json` file at the plugin root to apply default configuration
> when the plugin is enabled. **Currently, only the `agent` and `subagentStatusLine` keys are
> supported.** Unknown keys are silently ignored.

So a plugin **cannot** auto-install a top-level `statusLine`. The user must add the
`statusLine` field to their own `~/.claude/settings.json` (or the project's
`.claude/settings.json`) pointing at `${CLAUDE_PLUGIN_ROOT}/bin/statusline.js` — except
`${CLAUDE_PLUGIN_ROOT}` is only expanded by the plugin loader in specific contexts (hook
commands, MCP/LSP configs), not inside user settings. In practice:

- Plugin ships `bin/statusline.js`.
- On install, user runs `/usage-limiter:install-statusline` (or hand-edits settings) which
  writes the absolute path to `~/.claude/settings.json`'s `statusLine.command`.

**Impact on design:** Need an install helper command (slash command or `bin/` executable) that
wires up the statusline. Not a blocker for Phase B scaffolding but must be documented.

---

## 2. Hook blocking mechanism — ⚠️ DIFFERENT between hook events

**Assumption:** `{"decision":"block","reason":"..."}` on stdout blocks both hooks.

**Actual (verified in `/hooks` docs):**

- **`UserPromptSubmit`**: blocks with top-level
  ```json
  { "decision": "block", "reason": "Explanation shown to user" }
  ```
  The design's shape is correct for this hook.

- **`PreToolUse`**: uses a DIFFERENT shape —
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "reason shown to model"
    }
  }
  ```
  `permissionDecision` values: `"allow" | "deny" | "ask" | "defer"`. PreToolUse can also
  modify the tool input via `updatedInput`.

- **Exit code 2** on either hook: blocking error; stderr is fed back to Claude as an error
  message. Works as a fallback/simpler alternative to JSON output.
- **Exit 0 with no JSON** = allow.

**Impact on design:** `hooks/pre-tool-use.ts` must emit `hookSpecificOutput.permissionDecision`,
not `decision:"block"`. Update `check-limit.ts` to return a discriminated shape per event or
have the two hooks format their own output from a shared verdict.

---

## 3. `${PLUGIN_DIR}` substitution — WRONG name

**Assumption:** `${PLUGIN_DIR}` is the substitution for plugin-relative paths.

**Actual:** The variable is **`${CLAUDE_PLUGIN_ROOT}`**. There is also **`${CLAUDE_PLUGIN_DATA}`**
for a persistent data dir (`~/.claude/plugins/data/{id}/`) that survives plugin updates.

Both are substituted inline in hook commands, monitor commands, MCP/LSP configs, and skill/agent
content, and are exported as env vars to hook processes.

**Impact on design:** Use `${CLAUDE_PLUGIN_ROOT}` throughout. Consider `${CLAUDE_PLUGIN_DATA}`
for `cache.json` / `config.json` instead of `~/.claude/usage-limiter/` — but the design's
reasoning ("user can hand-edit") favours `~/.claude/usage-limiter/`, so keep it. Just make sure
not to write to `${CLAUDE_PLUGIN_ROOT}` since that is wiped on updates.

---

## 4. `rate_limits` shape in statusline stdin — CONFIRMED

**Assumption:** `rate_limits.seven_day.used_percentage` and `rate_limits.seven_day.resets_at`.

**Verified in `/statusline` docs (verbatim example):**
```json
"rate_limits": {
  "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
  "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
}
```

Also verified in binary: strings `rate_limits.seven_day.used_percentage`,
`rate_limits.five_hour.used_percentage`, `resets_at` all present.

**Caveats already in design:**
- `rate_limits` appears **only for Claude.ai subscribers (Pro/Max)** after the first API
  response in the session. Each window can be independently absent.
- `used_percentage` is a float 0..100 (not necessarily integer — design treats as number, fine).
- `resets_at` is unix epoch seconds.

**Impact:** none; design already handles absence ("Cache missing / stale → Allow + warn").

---

## 5. `UserPromptSubmit` hook stdin payload — CONFIRMED (cwd is present)

**Verbatim from `/hooks`:**
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-...jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

Common fields on all hooks: `session_id`, `transcript_path`, `cwd`, `permission_mode`,
`hook_event_name`. `UserPromptSubmit` adds `prompt`. `PreToolUse` adds `tool_name` and
`tool_input`.

**Impact on design:** none — design already reads `cwd` from payload. Bonus: `transcript_path`
gives us the exact JSONL to scan for this session, a cheap optimization later.

---

## Summary of design changes required

| # | Assumption | Status | Change needed |
|---|---|---|---|
| 1 | plugin.json schema | WRONG | Move to `.claude-plugin/plugin.json`; commands are files, not registered; use `hooks` inline or `hooks/hooks.json` |
| 1b | Plugin ships statusLine | DIFFERENT | Plugin can't auto-install statusLine. Provide `bin/statusline.js` + install instructions/slash command |
| 2 | Hook block shape | DIFFERENT | PreToolUse uses `hookSpecificOutput.permissionDecision: "deny"`, not `decision: "block"` |
| 3 | `${PLUGIN_DIR}` | WRONG | Use `${CLAUDE_PLUGIN_ROOT}` |
| 4 | `rate_limits` shape | CONFIRMED | none |
| 5 | `cwd` in UserPromptSubmit payload | CONFIRMED | none |

None of these block the MVP, but they do invalidate the literal `plugin.json` snippet in the
design. Phase B scaffolding below uses the corrected shapes.

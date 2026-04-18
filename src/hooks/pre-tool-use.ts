// PreToolUse hook — v0.1 placeholder.
// TODO(v0.2): mirror UserPromptSubmit logic but emit
//   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
//     "permissionDecision": "deny", "permissionDecisionReason": "..." } }
// Throttle: skip if last check in same session < 2s ago. See design.

export async function main(): Promise<void> {
  process.exit(0);
}

void main();

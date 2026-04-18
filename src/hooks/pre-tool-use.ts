// PreToolUse hook: reads JSON from stdin, decides whether to deny.
// Block shape: { "hookSpecificOutput": { "hookEventName": "PreToolUse",
//   "permissionDecision": "deny", "permissionDecisionReason": "..." } }
// Stub — implementation pending.

export async function main(): Promise<void> {
  // pending — allow by default
  process.exit(0);
}

import { strict as assert } from "node:assert";
import { test } from "node:test";

// Prevent main() from running on import.
process.env.PRE_TOOL_USE_NO_AUTORUN = "1";

const { denyOutput } = await import("../src/hooks/pre-tool-use.ts");

test("denyOutput: matches PreToolUse hookSpecificOutput shape", () => {
  const out = denyOutput("Project foo exceeded its 20% weekly budget.") as {
    hookSpecificOutput: {
      hookEventName: string;
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  assert.ok(out.hookSpecificOutput, "has hookSpecificOutput");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  // Reason includes original text AND the "do not retry" instruction.
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /exceeded/);
  assert.match(
    out.hookSpecificOutput.permissionDecisionReason,
    /DO NOT retry/,
    "block reason must explicitly tell the model to stop retrying",
  );
});

test("denyOutput: is JSON-serializable with no top-level decision key", () => {
  const out = denyOutput("x") as Record<string, unknown>;
  // PreToolUse shape must NOT use {"decision":"block"} — that's UserPromptSubmit's form.
  assert.equal(out.decision, undefined);
  const s = JSON.stringify(out);
  assert.match(s, /"hookSpecificOutput"/);
  assert.match(s, /"permissionDecision":"deny"/);
});

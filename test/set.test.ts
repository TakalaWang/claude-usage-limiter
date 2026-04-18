import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.USAGE_SET_NO_AUTORUN = "1";

const { parseArg, applyChange } = await import("../src/commands/set.ts");
const { parseConfig } = await import("../src/lib/config.ts");

test("parseArg: percent forms", () => {
  assert.deepEqual(parseArg("20%"), { kind: "percent", value: 20 });
  assert.deepEqual(parseArg("20.5%"), { kind: "percent", value: 20.5 });
  assert.deepEqual(parseArg(" 5% "), { kind: "percent", value: 5 });
});

test("parseArg: dollar forms", () => {
  assert.deepEqual(parseArg("$50"), { kind: "usd", value: 50 });
  assert.deepEqual(parseArg("$49.95"), { kind: "usd", value: 49.95 });
  assert.deepEqual(parseArg("50usd"), { kind: "usd", value: 50 });
  assert.deepEqual(parseArg("50USD"), { kind: "usd", value: 50 });
});

test("parseArg: rejects nonsense", () => {
  assert.throws(() => parseArg(""), /argument required/);
  assert.throws(() => parseArg("fifty"), /invalid value/);
  assert.throws(() => parseArg("50"), /invalid value/);
  assert.throws(() => parseArg("%50"), /invalid value/);
});

test("applyChange: replaces existing % with $ (switches kind)", () => {
  const cfg = parseConfig({
    version: 1,
    projects: { "/Users/foo": { weeklyPercent: 20 } },
  });
  const { next, prev } = applyChange(cfg, "/Users/foo", { kind: "usd", value: 50 });
  assert.deepEqual(prev, { weeklyPercent: 20 });
  assert.deepEqual(next.projects["/Users/foo"], { weeklyBudgetUSD: 50 });
  // Must round-trip through parseConfig (exactly-one constraint).
  parseConfig(next);
});

test("applyChange: rejects percent outside (0, 100]", () => {
  const cfg = parseConfig({ version: 1, projects: {} });
  assert.throws(
    () => applyChange(cfg, "/x", { kind: "percent", value: 0 }),
    /must be in \(0, 100\]/,
  );
  assert.throws(
    () => applyChange(cfg, "/x", { kind: "percent", value: 101 }),
    /must be in \(0, 100\]/,
  );
});

test("applyChange: rejects non-positive USD", () => {
  const cfg = parseConfig({ version: 1, projects: {} });
  assert.throws(
    () => applyChange(cfg, "/x", { kind: "usd", value: 0 }),
    /must be > 0/,
  );
});

test("applyChange: on empty config, inserts new project", () => {
  const cfg = parseConfig({ version: 1, projects: {} });
  const { next, prev } = applyChange(cfg, "/Users/new", {
    kind: "percent",
    value: 25,
  });
  assert.equal(prev, undefined);
  assert.deepEqual(next.projects["/Users/new"], { weeklyPercent: 25 });
});

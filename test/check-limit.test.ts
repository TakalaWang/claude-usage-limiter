import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseConfig } from "../src/lib/config.ts";
import { checkLimit } from "../src/lib/check-limit.ts";
import type { UsageCache } from "../src/lib/cache.ts";

test("checkLimit: no config → not limited", () => {
  const v = checkLimit("/tmp/does-not-matter", { config: null, cache: null });
  assert.equal(v.limited, false);
  assert.equal(v.overshoot, false);
});

test("checkLimit: cwd not listed in config → not limited", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/other-project": { weeklyPercent: 20 } },
  });
  const v = checkLimit("/Users/takala/code/unlisted", { config, cache: null });
  assert.equal(v.limited, false);
});

test("checkLimit: cache missing → limited but not overshoot (allow)", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyPercent: 20 } },
  });
  const v = checkLimit("/Users/takala/code/foo", { config, cache: null });
  assert.equal(v.limited, true);
  assert.equal(v.overshoot, false);
  assert.equal(v.cacheStale, true);
});

test("checkLimit: stale cache (>10 min) → allow", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyPercent: 20 } },
  });
  const now = 1_700_000_000;
  const cache: UsageCache = {
    updatedAt: now - 601, // > 10 min
    rateLimits: {
      sevenDay: { usedPercentage: 50, resetsAt: now + 86400 },
    },
  };
  const v = checkLimit("/Users/takala/code/foo", { config, cache, now });
  assert.equal(v.overshoot, false);
  assert.equal(v.cacheStale, true);
});

test("checkLimit: overshoot → block", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyPercent: 20 } },
  });
  const now = 1_700_000_000;
  const cache: UsageCache = {
    updatedAt: now, // fresh
    rateLimits: { sevenDay: { usedPercentage: 50, resetsAt: now + 86400 } },
  };
  // Account: 50% used on 1M tokens → budget = 2M. Project used 600k → 30% of budget > 20%.
  const v = checkLimit("/Users/takala/code/foo", {
    config,
    cache,
    now,
    scanProject: () => ({ tokens: 600_000, costUsd: 0, messages: 1 }),
    scanAll: () => ({ total: { tokens: 1_000_000, costUsd: 0, messages: 1 } }),
  });
  assert.equal(v.limited, true);
  assert.equal(v.overshoot, true);
  assert.ok(v.usedPercent > 20);
  assert.match(v.reason, /exceeded/);
});

test("checkLimit: under limit → allow", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyPercent: 20 } },
  });
  const now = 1_700_000_000;
  const cache: UsageCache = {
    updatedAt: now,
    rateLimits: { sevenDay: { usedPercentage: 50, resetsAt: now + 86400 } },
  };
  // Project used 100k of 1M total → 5% of budget, well under 20%.
  const v = checkLimit("/Users/takala/code/foo", {
    config,
    cache,
    now,
    scanProject: () => ({ tokens: 100_000, costUsd: 0, messages: 1 }),
    scanAll: () => ({ total: { tokens: 1_000_000, costUsd: 0, messages: 1 } }),
  });
  assert.equal(v.limited, true);
  assert.equal(v.overshoot, false);
  assert.ok(v.usedPercent < 20);
});

test("parseConfig: rejects non-numeric weeklyPercent", () => {
  assert.throws(
    () =>
      parseConfig({
        version: 1,
        projects: { "/x": { weeklyPercent: "oops" } },
      }),
    /weeklyPercent must be a number/,
  );
});

test("parseConfig: rejects wrong version", () => {
  assert.throws(() => parseConfig({ version: 2, projects: {} }), /version must be 1/);
});

test("parseConfig: rejects project with BOTH weeklyPercent and weeklyBudgetUSD", () => {
  assert.throws(
    () =>
      parseConfig({
        version: 1,
        projects: { "/x": { weeklyPercent: 20, weeklyBudgetUSD: 50 } },
      }),
    /both weeklyPercent and weeklyBudgetUSD/,
  );
});

test("parseConfig: accepts weeklyBudgetUSD alone", () => {
  const cfg = parseConfig({
    version: 1,
    projects: { "/x": { weeklyBudgetUSD: 50 } },
  });
  assert.equal(cfg.projects["/x"].weeklyBudgetUSD, 50);
  assert.equal(cfg.projects["/x"].weeklyPercent, undefined);
});

test("parseConfig: rejects non-positive weeklyBudgetUSD", () => {
  assert.throws(
    () => parseConfig({ version: 1, projects: { "/x": { weeklyBudgetUSD: 0 } } }),
    /must be > 0/,
  );
});

test("checkLimit: USD overshoot → block", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyBudgetUSD: 50 } },
  });
  const v = checkLimit("/Users/takala/code/foo", {
    config,
    cache: null,
    scanProject: () => ({ tokens: 0, costUsd: 75, messages: 10 }),
    scanAll: () => ({ total: { tokens: 0, costUsd: 75, messages: 10 } }),
  });
  assert.equal(v.limited, true);
  assert.equal(v.kind, "usd");
  assert.equal(v.overshoot, true);
  assert.equal(v.usedUsd, 75);
  assert.equal(v.limitUsd, 50);
  assert.match(v.reason, /\$50\.00 weekly budget/);
});

test("checkLimit: USD under → allow", () => {
  const config = parseConfig({
    version: 1,
    projects: { "/Users/takala/code/foo": { weeklyBudgetUSD: 50 } },
  });
  const v = checkLimit("/Users/takala/code/foo", {
    config,
    cache: null,
    scanProject: () => ({ tokens: 0, costUsd: 12.3, messages: 3 }),
    scanAll: () => ({ total: { tokens: 0, costUsd: 12.3, messages: 3 } }),
  });
  assert.equal(v.kind, "usd");
  assert.equal(v.overshoot, false);
});

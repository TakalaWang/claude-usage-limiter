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
    scanProject: () => ({ tokens: 600_000 }),
    scanAll: () => ({ total: { tokens: 1_000_000 } }),
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
    scanProject: () => ({ tokens: 100_000 }),
    scanAll: () => ({ total: { tokens: 1_000_000 } }),
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

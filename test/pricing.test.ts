import { strict as assert } from "node:assert";
import { test } from "node:test";
import { costUsdFor, priceForModel } from "../src/lib/pricing.ts";

test("priceForModel: opus family", () => {
  const p = priceForModel("claude-opus-4-6");
  assert.equal(p.input, 15);
  assert.equal(p.output, 75);
});

test("priceForModel: sonnet family", () => {
  const p = priceForModel("claude-sonnet-4-6");
  assert.equal(p.input, 3);
});

test("priceForModel: haiku family", () => {
  const p = priceForModel("claude-haiku-4-5");
  assert.equal(p.input, 0.8);
});

test("priceForModel: unknown model → sonnet fallback", () => {
  const p = priceForModel("claude-mystery-42");
  assert.equal(p.input, 3);
});

test("costUsdFor: opus sample math", () => {
  // 1M input + 500k output + 100k cache_write + 1M cache_read on opus
  const usd = costUsdFor(
    {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
    },
    "claude-opus-4-6",
  );
  // 15 + 0.5*75 + 0.1*18.75 + 1*1.5 = 15 + 37.5 + 1.875 + 1.5 = 55.875
  assert.ok(Math.abs(usd - 55.875) < 0.0001, `got ${usd}`);
});

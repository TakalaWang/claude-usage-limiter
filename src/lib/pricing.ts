// Per-model USD-per-token pricing. Values in $/million tokens (late 2025 public pricing).
// Conversion: usd = tokens * price_per_million / 1_000_000.
//
// Match model id against family via substring (e.g. "claude-opus-4-6" → opus).
// Unknown models fall back to Sonnet pricing and are logged via logWarning().

import { logError } from "./errors.js";

export interface ModelPrice {
  input: number; // $/M input tokens
  output: number; // $/M output tokens
  cacheWrite: number; // $/M cache-creation input tokens (5-min TTL)
  cacheRead: number; // $/M cache-read input tokens
}

export const PRICING: Record<string, ModelPrice> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
};

const warned = new Set<string>();

export function priceForModel(model: string | undefined): ModelPrice {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return PRICING.opus;
  if (m.includes("haiku")) return PRICING.haiku;
  if (m.includes("sonnet")) return PRICING.sonnet;
  // Unknown: fall back to Sonnet and warn once per model id.
  const key = m || "<missing>";
  if (!warned.has(key)) {
    warned.add(key);
    logError("pricing:unknown-model", new Error(`unknown model "${key}" — falling back to Sonnet pricing`));
  }
  return PRICING.sonnet;
}

export interface UsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function costUsdFor(usage: UsageBlock | undefined, model: string | undefined): number {
  if (!usage) return 0;
  const p = priceForModel(model);
  const M = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead) /
    M
  );
}

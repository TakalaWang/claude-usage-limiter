// Per-model token pricing (USD per 1M tokens).
// Stub — implementation pending.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export function priceFor(_model: string): ModelPricing | null {
  return null;
}

// Incremental JSONL scan cache.
//
// Stored at ~/.claude/usage-limiter/scan-cache.json:
//   { files: { "<abs-path>": { size, offset, tokens, costUsd, lastTs } } }
//
// On scan: for each JSONL file in the project dir,
//   1. stat(path).size < cache.offset  → file rotated/shrunk, full re-read
//   2. stat(path).size === cache.offset → nothing new, reuse cache
//   3. stat(path).size >   cache.offset → read only [offset, size)
// Entries whose lastTs < windowStart are dropped (outside the 7-day window).
//
// When the cache file is missing or unparseable we fall back to a full scan
// and rebuild from scratch. The full-scan fallback in scan.ts is still the
// ultimate safety net if this module throws.

import {
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { USAGE_LIMITER_DIR, PROJECTS_DIR, encodeCwd } from "./paths.js";
import { accumulateLine, type ProjectUsage } from "./scan.js";

export const SCAN_CACHE_PATH = join(USAGE_LIMITER_DIR, "scan-cache.json");

interface FileEntry {
  size: number;
  offset: number;
  tokens: number;
  costUsd: number;
  messages: number;
  lastTs: number; // unix seconds — highest timestamp seen in this file's in-window messages
}

interface ScanCache {
  version: 1;
  files: Record<string, FileEntry>;
}

function emptyCache(): ScanCache {
  return { version: 1, files: {} };
}

function readCache(): ScanCache {
  try {
    const raw = readFileSync(SCAN_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ScanCache;
    if (parsed && parsed.version === 1 && parsed.files) return parsed;
  } catch {
    // missing or malformed — start fresh
  }
  return emptyCache();
}

function writeCache(cache: ScanCache): void {
  try {
    mkdirSync(dirname(SCAN_CACHE_PATH), { recursive: true });
    const tmp = `${SCAN_CACHE_PATH}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, SCAN_CACHE_PATH);
  } catch {
    // Best-effort; on failure we just scan again next time.
  }
}

// Read bytes [start, end) from path — used for incremental append reads.
function readRange(path: string, start: number, end: number): string {
  if (end <= start) return "";
  const fd = openSync(path, "r");
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function listJsonl(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Scan one chunk of text, splitting on newlines and accumulating into acc.
// Returns the number of bytes consumed that ended on a newline — the rest
// (trailing partial line) is reported back so the caller can keep the offset
// just before it (so the next run sees the full line).
function scanChunk(
  chunk: string,
  sinceEpochMs: number,
  acc: ProjectUsage,
): { consumedBytes: number; maxTs: number } {
  let consumed = 0;
  let maxTs = 0;
  const totalBytes = Buffer.byteLength(chunk, "utf8");
  let cursor = 0;
  while (cursor < chunk.length) {
    const nl = chunk.indexOf("\n", cursor);
    if (nl === -1) break; // trailing partial line — stop before it
    const line = chunk.slice(cursor, nl);
    const before = acc.tokens;
    accumulateLine(line, sinceEpochMs, acc);
    if (acc.tokens !== before) {
      // Extract timestamp for lastTs tracking (best effort, ignore failures).
      try {
        const ts = Date.parse((JSON.parse(line) as { timestamp?: string }).timestamp ?? "");
        if (isFinite(ts) && ts > maxTs) maxTs = ts;
      } catch {
        // ignore
      }
    }
    cursor = nl + 1;
    consumed = Buffer.byteLength(chunk.slice(0, cursor), "utf8");
  }
  // If the chunk has no trailing partial line, consumed will equal totalBytes.
  if (cursor >= chunk.length) consumed = totalBytes;
  return { consumedBytes: consumed, maxTs: Math.floor(maxTs / 1000) };
}

function fullScanFile(
  path: string,
  sinceEpochMs: number,
): { entry: FileEntry; delta: ProjectUsage } {
  const size = statSync(path).size;
  const contents = readFileSync(path, "utf8");
  const acc: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
  const { consumedBytes, maxTs } = scanChunk(contents, sinceEpochMs, acc);
  const entry: FileEntry = {
    size,
    offset: consumedBytes,
    tokens: acc.tokens,
    costUsd: acc.costUsd,
    messages: acc.messages,
    lastTs: maxTs,
  };
  return { entry, delta: acc };
}

// Scan one project dir incrementally. Returns totals AND the updated cache so the
// caller can persist the whole cache at once.
export function scanProjectIncremental(
  cwd: string,
  windowStartEpoch: number,
  cache: ScanCache,
): ProjectUsage {
  const dir = join(PROJECTS_DIR, encodeCwd(cwd));
  const windowStartMs = windowStartEpoch * 1000;
  const total: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };

  const seen = new Set<string>();
  for (const path of listJsonl(dir)) {
    seen.add(path);
    const prior = cache.files[path];
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }

    if (prior && prior.lastTs > 0 && prior.lastTs * 1000 < windowStartMs) {
      // Entire prior contribution sits outside the window. Reset and rescan only
      // new bytes (which may themselves be in-window).
      delete cache.files[path];
    }

    const existing = cache.files[path];
    if (!existing || size < existing.offset) {
      // New file, missing cache, or rotated (shrunk) → full rescan.
      const { entry } = fullScanFile(path, windowStartMs);
      cache.files[path] = entry;
      total.tokens += entry.tokens;
      total.costUsd += entry.costUsd;
      total.messages += entry.messages;
      continue;
    }

    if (size === existing.offset) {
      // No new bytes.
      total.tokens += existing.tokens;
      total.costUsd += existing.costUsd;
      total.messages += existing.messages;
      cache.files[path] = { ...existing, size };
      continue;
    }

    // Append path: read only the new bytes.
    const chunk = readRange(path, existing.offset, size);
    const delta: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
    const { consumedBytes, maxTs } = scanChunk(chunk, windowStartMs, delta);
    const merged: FileEntry = {
      size,
      offset: existing.offset + consumedBytes,
      tokens: existing.tokens + delta.tokens,
      costUsd: existing.costUsd + delta.costUsd,
      messages: existing.messages + delta.messages,
      lastTs: maxTs > existing.lastTs ? maxTs : existing.lastTs,
    };
    cache.files[path] = merged;
    total.tokens += merged.tokens;
    total.costUsd += merged.costUsd;
    total.messages += merged.messages;
  }

  // Drop cache entries for files that no longer exist under this project dir.
  for (const p of Object.keys(cache.files)) {
    if (p.startsWith(dir + "/") && !seen.has(p)) delete cache.files[p];
  }

  return total;
}

// High-level: load cache, scan, persist cache.
export function scanProjectUsageCached(
  cwd: string,
  windowStartEpoch: number,
): ProjectUsage {
  const cache = readCache();
  const total = scanProjectIncremental(cwd, windowStartEpoch, cache);
  writeCache(cache);
  return total;
}

// Exposed for tests.
export const _internals = { readCache, writeCache, scanChunk, fullScanFile };

// Incremental JSONL scan cache.
// ~/.claude/usage-limiter/scan-cache.json: { files: { "<abs-path>": { size, offset, ... } } }
// size < offset → rotated, full rescan; size == offset → reuse; size > offset → read [offset, size).
// Entries with lastTs < windowStart are dropped. On any failure we fall back to full-scan.
import {
  mkdirSync, openSync, closeSync, readSync, readFileSync, readdirSync,
  renameSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { USAGE_LIMITER_DIR, PROJECTS_DIR, encodeCwd } from "./paths.js";
import { accumulateLine, type ProjectUsage } from "./scan.js";

export const SCAN_CACHE_PATH = join(USAGE_LIMITER_DIR, "scan-cache.json");

interface FileEntry {
  size: number; offset: number; tokens: number; costUsd: number; messages: number;
  lastTs: number; // unix seconds — highest timestamp seen in this file's in-window messages
}
interface ScanCache { version: 1; files: Record<string, FileEntry>; }
const emptyCache = (): ScanCache => ({ version: 1, files: {} });

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

// Read bytes [start, end) from path.
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
  } finally { closeSync(fd); }
}

function listJsonl(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Split chunk on newlines, accumulate into acc. Returns bytes consumed ending on \n
// (trailing partial line is left for the next run).
function scanChunk(
  chunk: string, sinceEpochMs: number, acc: ProjectUsage,
): { consumedBytes: number; maxTs: number } {
  let consumed = 0, maxTs = 0, cursor = 0;
  const totalBytes = Buffer.byteLength(chunk, "utf8");
  while (cursor < chunk.length) {
    const nl = chunk.indexOf("\n", cursor);
    if (nl === -1) break;
    const line = chunk.slice(cursor, nl);
    const before = acc.tokens;
    accumulateLine(line, sinceEpochMs, acc);
    if (acc.tokens !== before) {
      try {
        const ts = Date.parse((JSON.parse(line) as { timestamp?: string }).timestamp ?? "");
        if (isFinite(ts) && ts > maxTs) maxTs = ts;
      } catch { /* ignore */ }
    }
    cursor = nl + 1;
    consumed = Buffer.byteLength(chunk.slice(0, cursor), "utf8");
  }
  if (cursor >= chunk.length) consumed = totalBytes;
  return { consumedBytes: consumed, maxTs: Math.floor(maxTs / 1000) };
}

function fullScanFile(path: string, sinceEpochMs: number): FileEntry {
  const size = statSync(path).size;
  const contents = readFileSync(path, "utf8");
  const acc: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
  const { consumedBytes, maxTs } = scanChunk(contents, sinceEpochMs, acc);
  return { size, offset: consumedBytes, tokens: acc.tokens, costUsd: acc.costUsd, messages: acc.messages, lastTs: maxTs };
}

function addInto(total: ProjectUsage, e: { tokens: number; costUsd: number; messages: number }): void {
  total.tokens += e.tokens; total.costUsd += e.costUsd; total.messages += e.messages;
}

// Scan one project dir incrementally. Mutates `cache`.
export function scanProjectIncremental(
  cwd: string, windowStartEpoch: number, cache: ScanCache,
): ProjectUsage {
  const dir = join(PROJECTS_DIR, encodeCwd(cwd));
  const windowStartMs = windowStartEpoch * 1000;
  const total: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
  const seen = new Set<string>();

  for (const path of listJsonl(dir)) {
    seen.add(path);
    let size: number;
    try { size = statSync(path).size; } catch { continue; }

    // Prior contribution entirely outside window → drop and rebuild.
    const prior = cache.files[path];
    if (prior && prior.lastTs > 0 && prior.lastTs * 1000 < windowStartMs) {
      delete cache.files[path];
    }

    const existing = cache.files[path];
    if (!existing || size < existing.offset) {
      // New / missing / rotated: full rescan.
      const entry = fullScanFile(path, windowStartMs);
      cache.files[path] = entry;
      addInto(total, entry);
      continue;
    }
    if (size === existing.offset) {
      cache.files[path] = { ...existing, size };
      addInto(total, existing);
      continue;
    }
    // Append: read only the new bytes.
    const chunk = readRange(path, existing.offset, size);
    const delta: ProjectUsage = { tokens: 0, costUsd: 0, messages: 0 };
    const { consumedBytes, maxTs } = scanChunk(chunk, windowStartMs, delta);
    const merged: FileEntry = {
      size, offset: existing.offset + consumedBytes,
      tokens: existing.tokens + delta.tokens,
      costUsd: existing.costUsd + delta.costUsd,
      messages: existing.messages + delta.messages,
      lastTs: maxTs > existing.lastTs ? maxTs : existing.lastTs,
    };
    cache.files[path] = merged;
    addInto(total, merged);
  }

  // Drop entries for files that vanished under this project dir.
  for (const p of Object.keys(cache.files)) {
    if (p.startsWith(dir + "/") && !seen.has(p)) delete cache.files[p];
  }
  return total;
}

export function scanProjectUsageCached(cwd: string, windowStartEpoch: number): ProjectUsage {
  const cache = readCache();
  const total = scanProjectIncremental(cwd, windowStartEpoch, cache);
  writeCache(cache);
  return total;
}

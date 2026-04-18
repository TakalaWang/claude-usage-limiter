import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Override HOME so paths.ts resolves into a throwaway dir. paths.ts reads HOME
// at import time, so this env var must be set BEFORE the first import.
const sandbox = mkdtempSync(join(tmpdir(), "culim-scan-"));
process.env.HOME = sandbox;

const { scanProjectIncremental } = await import("../src/lib/scan-cache.ts");
const { PROJECTS_DIR, encodeCwd } = await import("../src/lib/paths.ts");

// Helpers --------------------------------------------------------------------

function mkAssistantLine(ts: string, inputTokens: number, model = "claude-sonnet-4-6"): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { usage: { input_tokens: inputTokens }, model },
  });
}

function setup(cwd: string): string {
  const dir = join(PROJECTS_DIR, encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup() {
  rmSync(sandbox, { recursive: true, force: true });
}

// Tests ----------------------------------------------------------------------

test("new-file: first scan reads everything and populates cache", () => {
  const cwd = "/Users/test/proj1";
  const dir = setup(cwd);
  const file = join(dir, "a.jsonl");
  writeFileSync(file, mkAssistantLine("2026-04-15T00:00:00Z", 100) + "\n");

  const cache = { version: 1 as const, files: {} };
  const windowStart = Math.floor(Date.parse("2026-04-10T00:00:00Z") / 1000);
  const total = scanProjectIncremental(cwd, windowStart, cache);
  assert.equal(total.tokens, 100);
  assert.equal(total.messages, 1);
  assert.ok(cache.files[file]);
  assert.equal(cache.files[file].tokens, 100);
  assert.ok(cache.files[file].offset > 0);
});

test("append: second scan reads only new bytes", () => {
  const cwd = "/Users/test/proj2";
  const dir = setup(cwd);
  const file = join(dir, "b.jsonl");
  writeFileSync(file, mkAssistantLine("2026-04-15T00:00:00Z", 100) + "\n");
  const cache = { version: 1 as const, files: {} };
  const windowStart = Math.floor(Date.parse("2026-04-10T00:00:00Z") / 1000);

  scanProjectIncremental(cwd, windowStart, cache);
  const prevOffset = cache.files[file].offset;

  // Append another message.
  appendFileSync(file, mkAssistantLine("2026-04-16T00:00:00Z", 250) + "\n");
  const total = scanProjectIncremental(cwd, windowStart, cache);
  assert.equal(total.tokens, 350);
  assert.equal(total.messages, 2);
  assert.ok(cache.files[file].offset > prevOffset);
});

test("rotation: shrunk file triggers full rescan from scratch", () => {
  const cwd = "/Users/test/proj3";
  const dir = setup(cwd);
  const file = join(dir, "c.jsonl");
  writeFileSync(
    file,
    mkAssistantLine("2026-04-15T00:00:00Z", 100) + "\n" +
      mkAssistantLine("2026-04-15T01:00:00Z", 200) + "\n",
  );
  const cache = { version: 1 as const, files: {} };
  const windowStart = Math.floor(Date.parse("2026-04-10T00:00:00Z") / 1000);
  scanProjectIncremental(cwd, windowStart, cache);
  assert.equal(cache.files[file].tokens, 300);

  // Rotate: truncate and replace with a single smaller line.
  writeFileSync(file, mkAssistantLine("2026-04-17T00:00:00Z", 50) + "\n");
  const total = scanProjectIncremental(cwd, windowStart, cache);
  assert.equal(total.tokens, 50, "full rescan after rotation");
  assert.equal(total.messages, 1);
});

test("invalidation: file whose lastTs predates windowStart is dropped and rescanned", () => {
  const cwd = "/Users/test/proj4";
  const dir = setup(cwd);
  const file = join(dir, "d.jsonl");
  writeFileSync(file, mkAssistantLine("2026-04-01T00:00:00Z", 500) + "\n");

  // First run: wide window captures the entry.
  const cache = { version: 1 as const, files: {} };
  const wideStart = Math.floor(Date.parse("2026-03-20T00:00:00Z") / 1000);
  scanProjectIncremental(cwd, wideStart, cache);
  assert.equal(cache.files[file].tokens, 500);

  // Second run: narrow window excludes the one line — it's old now.
  const narrowStart = Math.floor(Date.parse("2026-04-15T00:00:00Z") / 1000);
  const total = scanProjectIncremental(cwd, narrowStart, cache);
  assert.equal(total.tokens, 0, "old message excluded");
  assert.equal(cache.files[file].tokens, 0);
});

test("cleanup sandbox", () => {
  cleanup();
});

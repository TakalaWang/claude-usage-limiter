import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeDir } from "../src/lib/paths.js";

test("claudeDir: uses CLAUDE_CONFIG_DIR when set", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/tmp/custom-claude-dir";
  try {
    assert.equal(claudeDir(), "/tmp/custom-claude-dir");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test("claudeDir: falls back to ~/.claude when env is empty", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.equal(claudeDir(), join(homedir(), ".claude"));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test("claudeDir: treats empty string as unset", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "";
  try {
    assert.equal(claudeDir(), join(homedir(), ".claude"));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

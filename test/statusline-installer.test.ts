import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set env BEFORE importing the module so SETTINGS_PATH resolves against it.
const sandbox = mkdtempSync(join(tmpdir(), "cul-installer-"));
process.env.CLAUDE_CONFIG_DIR = sandbox;
process.env.CLAUDE_PLUGIN_ROOT = "/fake/plugin/root";

const { wireStatusline } = await import("../src/lib/statusline-installer.js");

const settingsPath = join(sandbox, "settings.json");
const expectedCommand = "node /fake/plugin/root/bin/statusline.js";

function reset(): void {
  for (const name of readdirSync(sandbox)) {
    rmSync(join(sandbox, name), { recursive: true, force: true });
  }
}

test("wireStatusline: installs on fresh settings (file missing)", () => {
  reset();
  const r = wireStatusline();
  assert.equal(r.status, "installed");
  assert.ok(existsSync(settingsPath));
  const written = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(written.statusLine.command, expectedCommand);
});

test("wireStatusline: installs and backs up existing non-statusline settings", () => {
  reset();
  writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  const r = wireStatusline();
  assert.equal(r.status, "installed");
  if (r.status === "installed") assert.ok(r.backup);
  const written = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(written.theme, "dark");
  assert.equal(written.statusLine.command, expectedCommand);
});

test("wireStatusline: idempotent when already installed", () => {
  reset();
  writeFileSync(
    settingsPath,
    JSON.stringify({ statusLine: { type: "command", command: expectedCommand } }),
  );
  const r = wireStatusline();
  assert.equal(r.status, "already-installed");
});

test("wireStatusline: refuses to overwrite a different statusLine", () => {
  reset();
  writeFileSync(
    settingsPath,
    JSON.stringify({ statusLine: { type: "command", command: "some other sl" } }),
  );
  const r = wireStatusline();
  assert.equal(r.status, "other-present");
  if (r.status === "other-present") assert.equal(r.existing, "some other sl");
});

test("wireStatusline: reports invalid JSON", () => {
  reset();
  writeFileSync(settingsPath, "{not json");
  const r = wireStatusline();
  assert.equal(r.status, "invalid-settings");
});

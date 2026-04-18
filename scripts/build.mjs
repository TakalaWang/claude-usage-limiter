#!/usr/bin/env node
// Bundle each entry point with esbuild into bin/<name>.js, ESM, node20 target.
import { build } from "esbuild";
import { chmodSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "bin");

const entries = [
  { in: "statusline/index.ts", out: "statusline.js" },
  { in: "hooks/user-prompt-submit.ts", out: "hooks/user-prompt-submit.js" },
  { in: "hooks/pre-tool-use.ts", out: "hooks/pre-tool-use.js" },
  { in: "commands/status.ts", out: "commands/status.js" },
  { in: "commands/set.ts", out: "commands/set.js" },
  { in: "commands/install-statusline.ts", out: "commands/install-statusline.js" },
];

mkdirSync(OUT, { recursive: true });

await Promise.all(
  entries.map((e) =>
    build({
      entryPoints: [join(SRC, e.in)],
      outfile: join(OUT, e.out),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      external: [],
      banner: { js: "#!/usr/bin/env node" },
      logLevel: "warning",
    }),
  ),
);

// chmod +x every .js we produced.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) chmodSync(p, 0o755);
  }
}
walk(OUT);

console.log(`Built ${entries.length} bundles → ${OUT}`);

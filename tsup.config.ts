import { defineConfig } from "tsup";
import { cpSync, readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
// @ts-expect-error -- a plain .mjs script, no types
import { inkPatchState } from "./scripts/apply-ink-patch.mjs";

const _require = createRequire(import.meta.url);
const pkg = _require("./package.json") as { version: string };

// `ink` is bundled into dist (below), and the copy that goes in must be the patched one (PERF2-01): users install
// `ink` from the registry, where the stock file would silently give back the slow frames.
const inkState = inkPatchState() as string;
if (inkState !== "patched") {
  throw new Error(
    `node_modules/ink/build/ is "${inkState}", not the patched files. Run \`node scripts/apply-ink-patch.mjs\` (see patches/ink/README.md).`
  );
}

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  // Ink itself is bundled so that the patched output stage (patches/ink) reaches users; its own dependencies
  // stay external when they are in package.json, and are bundled otherwise. The Ink components import `ink`
  // too: left external they would load a second, stock copy of it (with its own contexts, so no input, no focus).
  // Some of the bundled dependencies of Ink are CommonJS and `require()` Node built-ins (signal-exit: "assert").
  banner: {
    js: 'import { createRequire as __goblinCreateRequire } from "module"; const require = __goblinCreateRequire(import.meta.url);',
  },
  noExternal: ["ink", "ink-select-input", "ink-text-input"],
  // Ink loads its devtools only when the optional package is installed (it checks first); it is not ours to ship.
  external: ["react-devtools-core"],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  async onSuccess() {
    // A leftover `ink` import (any form: import, dynamic import, require, `ink/...` subpath), in any file of dist,
    // would load the stock Ink next to the bundled one: two React contexts, no input, or the slow frames back.
    const inkImport = /(?:from|import|require)\s*\(?\s*["']ink(?:\/[^"']*)?["']/;
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`;
        if (entry.isDirectory()) scan(file);
        else if (/\.[cm]?js$/.test(entry.name) && inkImport.test(readFileSync(file, "utf-8"))) {
          throw new Error(`${file} imports "ink": it must be bundled (patched Ink, see patches/ink).`);
        }
      }
    };
    scan("dist");
    cpSync("src/assets", "dist/assets", { recursive: true });
  },
});

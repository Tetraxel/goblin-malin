/**
 * Installs Goblin Malin's patched `output.js` over the one in `node_modules/ink/build/` (see
 * `patches/ink/output.js` for what it changes and why, and AUDIT-performance-2.md, PERF2-01).
 *
 *   node scripts/apply-ink-patch.mjs           # apply (run by `prepare`, i.e. after every `yarn install`)
 *   node scripts/apply-ink-patch.mjs --check   # only report: exits 1 unless the patched file is in place
 *
 * It refuses to touch a file that is neither the stock Ink 8.0.0 one nor already the patched one: after an Ink
 * upgrade the patch has to be redone on the new file (patches/ink/README.md says how), not silently dropped.
 * `tsup.config.ts` runs the same check before bundling, so `dist` can never ship the stock file by accident.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(here, "..", "patches", "ink");

function inkOutputPath() {
    const require = createRequire(join(here, "..", "package.json"));
    // `ink` only exports its entry point, so find the package folder from it.
    const entry = require.resolve("ink");
    return join(dirname(entry), "output.js");
}

/** @returns {"patched" | "stock" | "unknown" | "missing"} */
export function inkPatchState() {
    let target;
    try {
        target = inkOutputPath();
    } catch {
        return "missing";
    }
    if (!existsSync(target)) return "missing";
    // The stock file ends with a source-map comment, which patches/ink/output.stock.js leaves out.
    const current = readFileSync(target, "utf-8").replace(/\n?\/\/# sourceMappingURL=.*\n?$/, "\n");
    if (current === readFileSync(join(patchesDir, "output.js"), "utf-8")) return "patched";
    if (current === readFileSync(join(patchesDir, "output.stock.js"), "utf-8")) return "stock";
    return "unknown";
}

export function applyInkPatch() {
    const state = inkPatchState();
    if (state === "patched") return state;
    if (state === "stock") {
        copyFileSync(join(patchesDir, "output.js"), inkOutputPath());
        return "applied";
    }
    return state;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    if (process.argv.includes("--check")) {
        const state = inkPatchState();
        console.log(`ink output.js: ${state}`);
        process.exit(state === "patched" ? 0 : 1);
    }
    const result = applyInkPatch();
    if (result === "applied") console.log("goblin-malin: patched node_modules/ink/build/output.js (PERF2-01)");
    if (result === "unknown") {
        console.error(
            "goblin-malin: node_modules/ink/build/output.js is neither the stock Ink 8.0.0 file nor the patched one.\n" +
                "Ink was probably upgraded: redo the patch on the new file (see patches/ink/README.md)."
        );
        process.exit(1);
    }
    if (result === "missing") console.warn("goblin-malin: ink is not installed, nothing to patch.");
}

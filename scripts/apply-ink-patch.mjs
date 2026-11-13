/**
 * Installs Goblin Malin's patched `output.js` and `render-node-to-output.js` over the ones in
 * `node_modules/ink/build/` (see `patches/ink/output.js` for what they change and why, and
 * AUDIT-performance-2.md, PERF2-01 and PERF2-07).
 *
 *   node scripts/apply-ink-patch.mjs           # apply (run by `prepare`, i.e. after every `yarn install`)
 *   node scripts/apply-ink-patch.mjs --check   # only report: exits 1 unless the patched file is in place
 *
 * It refuses to touch a file that is neither the stock Ink 8.0.0 one nor already the patched one (or an older
 * version of our own patch): after an Ink upgrade the patch has to be redone on the new file (patches/ink/README.md says how), not silently dropped.
 * `tsup.config.ts` runs the same check before bundling, so `dist` can never ship the stock file by accident.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(here, "..", "patches", "ink");
/** The files of `ink/build/` that are replaced; `<name>.js` is the patched one, `<name>.stock.js` the original. */
const FILES = ["output", "render-node-to-output"];

function inkBuildDir() {
    const require = createRequire(join(here, "..", "package.json"));
    // `ink` only exports its entry point, so find the package folder from it.
    return dirname(require.resolve("ink"));
}

/** @returns {"patched" | "stock" | "unknown" | "missing"} */
function fileState(buildDir, name) {
    const target = join(buildDir, `${name}.js`);
    if (!existsSync(target)) return "missing";
    // The stock file ends with a source-map comment, which patches/ink/*.stock.js leaves out.
    const current = readFileSync(target, "utf-8").replace(/\n?\/\/# sourceMappingURL=.*\n?$/, "\n");
    if (current === readFileSync(join(patchesDir, `${name}.js`), "utf-8")) return "patched";
    if (current === readFileSync(join(patchesDir, `${name}.stock.js`), "utf-8")) return "stock";
    // An older version of our own patch (the repository moved on since the last install): safe to replace.
    if (current.includes("Goblin Malin's patched copy")) return "stock";
    return "unknown";
}

/** @returns {"patched" | "stock" | "partial" | "unknown" | "missing"} `stock`: every file is the original or an old patch. */
export function inkPatchState() {
    let buildDir;
    try {
        buildDir = inkBuildDir();
    } catch {
        return "missing";
    }
    const states = FILES.map((name) => fileState(buildDir, name));
    if (states.every((s) => s === "patched")) return "patched";
    if (states.every((s) => s === "stock")) return "stock";
    if (states.includes("missing")) return "missing";
    // A mix (one file patched, one stock) is a half-applied patch: apply finishes it.
    return states.every((s) => s === "patched" || s === "stock") ? "partial" : "unknown";
}

export function applyInkPatch() {
    const state = inkPatchState();
    if (state === "patched") return state;
    if (state === "stock" || state === "partial") {
        const buildDir = inkBuildDir();
        for (const name of FILES) copyFileSync(join(patchesDir, `${name}.js`), join(buildDir, `${name}.js`));
        return "applied";
    }
    return state;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    if (process.argv.includes("--check")) {
        const state = inkPatchState();
        console.log(`ink build files: ${state}`);
        process.exit(state === "patched" ? 0 : 1);
    }
    const result = applyInkPatch();
    if (result === "applied")
        console.log("goblin-malin: patched node_modules/ink/build/ (output.js, render-node-to-output.js)");
    if (result === "unknown") {
        // A warning, not a failure: this runs from `prepare`, and an install must not break for work that has
        // nothing to do with rendering. `yarn build` (tsup.config.ts) refuses to bundle unpatched files.
        console.warn(
            "goblin-malin: node_modules/ink/build/{output,render-node-to-output}.js are neither the stock Ink 8.0.0 files nor the patched ones.\n" +
                "Ink was probably upgraded: redo the patch on the new file (see patches/ink/README.md). `yarn build` will refuse to run until then."
        );
    }
    if (result === "missing") console.warn("goblin-malin: ink is not installed, nothing to patch.");
}

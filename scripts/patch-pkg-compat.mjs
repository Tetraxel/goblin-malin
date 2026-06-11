/**
 * Patches packages that cause issues when bundled with @yao-pkg/pkg.
 *
 * Patch types:
 *   - pkgJsonPatches:  rewrite a package's exports field (fixes ERR_PACKAGE_PATH_NOT_EXPORTED)
 *   - sourcePatches:   regex-replace inside a source file (fixes unresolvable #-imports)
 *   - yogaLayoutFix:   esbuild-bundle yoga-layout into a single self-contained ESM file.
 *
 * WHY yoga-layout needs special treatment:
 *   pkg patches CJS require() to serve files from the virtual snapshot filesystem, but
 *   Node's native ESM import resolver bypasses those patches. yoga-layout/dist/src/index.js
 *   is included in the snapshot as source (bytecode compilation fails due to top-level await
 *   + exports), and its relative ESM imports (wrapAssembly.js, YGEnums.js, the WASM binary)
 *   all fail at runtime with ERR_MODULE_NOT_FOUND.
 *
 *   Solution: pre-bundle yoga-layout with esbuild into a single ESM file before passing to
 *   pkg. The bundle has no relative imports, so Node's ESM loader never needs to resolve any.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { buildSync } from "esbuild";

// esbuild plugin: replaces `import.meta.url` with a safe placeholder in bundled submodules.
// Needed because esbuild emits `var import_meta = {}` for sub-module imports, making
// import.meta.url undefined at runtime — which causes fileURLToPath to throw.
// The placeholder only affects code that checks for optional binaries on disk (clipboardy,
// etc.) — those checks will correctly see "binary not found" and fall back to alternatives.
const importMetaUrlShimPlugin = {
    name: "import-meta-url-shim",
    setup(build) {
        build.onLoad({ filter: /\.js$/ }, (args) => {
            const contents = readFileSync(args.path, "utf8");
            if (!contents.includes("import.meta.url")) return;
            const shimmed = contents.replace(/\bimport\.meta\.url\b/g, '"file:///pkg-bundled"');
            return { contents: shimmed, loader: "js" };
        });
    },
};

// --- package.json export patches ---

const pkgJsonPatches = [
    {
        pkg: "flac-tagger",
        // Has only "import" — no "." or "require" condition.
        exports: {
            ".": {
                require: "./dist/index.js",
                import: "./dist/index.js",
                types: "./dist/index.d.ts",
            },
        },
    },
    {
        pkg: "@alcalzone/ansi-tokenize",
        // Has only "import" — no "main" or "require" condition (used by ink).
        exports: {
            ".": {
                require: "./build/index.js",
                import: "./build/index.js",
                types: "./build/index.d.ts",
            },
            "./package.json": "./package.json",
        },
    },
    {
        pkg: "unicorn-magic",
        // Has environment-conditional exports but no "." main or "require" condition.
        exports: {
            ".": {
                require: "./node.js",
                import: "./node.js",
                default: "./node.js",
            },
        },
    },
];

for (const { pkg, exports } of pkgJsonPatches) {
    const pkgJsonPath = resolve("node_modules", pkg, "package.json");
    try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        pkgJson.exports = exports;
        writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
        console.log(`patch-pkg-compat: patched ${pkg} (package.json)`);
    } catch {
        console.warn(`patch-pkg-compat: could not patch ${pkg} (not installed?)`);
    }
}

// --- source file patches ---

const sourcePatches = [
    {
        // chalk uses package.json "imports" for #ansi-styles / #supports-color.
        // pkg doesn't resolve "imports" fields, so replace them with relative paths.
        file: "chalk/source/index.js",
        replacements: [
            { from: /from\s+'#ansi-styles'/g, to: "from './vendor/ansi-styles/index.js'" },
            { from: /from\s+'#supports-color'/g, to: "from './vendor/supports-color/index.js'" },
        ],
    },
    {
        // ink/build/reconciler.js has two top-level `await` expressions inside
        // `if (process.env['DEV'] === 'true')` blocks.  These are dead code in production
        // but they prevent pkg from compiling this file to bytecode, causing it to be
        // included as ESM source — where bare `import 'react-reconciler'` fails in the
        // pkg snapshot (Node's ESM resolver doesn't use pkg's patched require for packages).
        // Fix: drop the `await` keywords so the imports become fire-and-forget async calls.
        file: "ink/build/reconciler.js",
        replacements: [
            // await import('./devtools.js')  →  void import('./devtools.js')
            { from: /await import\('\.\/devtools\.js'\)/, to: "void import('./devtools.js')" },
            // const loaded = await loadPackageJson()  →  remove await (DEV-only dead code in prod)
            { from: /const loaded = await loadPackageJson\(\)/, to: "const loaded = loadPackageJson()" },
        ],
    },
];

for (const { file, replacements } of sourcePatches) {
    const filePath = resolve("node_modules", file);
    try {
        let src = readFileSync(filePath, "utf8");
        for (const { from, to } of replacements) {
            src = src.replace(from, to);
        }
        writeFileSync(filePath, src, "utf8");
        console.log(`patch-pkg-compat: patched ${file} (source)`);
    } catch {
        console.warn(`patch-pkg-compat: could not patch ${file} (not installed?)`);
    }
}

// --- yoga-layout: synchronous CJS wrapper ---
//
// pkg's ESM→CJS transformer converts `import Yoga from 'yoga-layout'` to
// `require('yoga-layout')`. In Node 22, require() of an ESM module with top-level
// await fails with ERR_REQUIRE_ASYNC_MODULE.
//
// Fix: create a CJS entry point (yoga-layout-sync.cjs) that:
//   1. Compiles the WASM binary synchronously (WebAssembly.Module — sync API)
//   2. Runs the Emscripten IIFE in a vm sandbox with a synchronous instantiateWasm hook
//   3. Calls wrapAssembly() and exports the Yoga object directly — zero top-level await
//
// The "require" condition in yoga-layout's exports map then routes pkg's require()
// calls to this file.  ESM import() calls continue to use the original index.js.
try {
    // Read yoga WASM source now and inline it — avoids readFileSync with __dirname at runtime,
    // which breaks in esbuild bundles where __dirname is no longer the yoga-layout directory.
    const yogaWasmSrc = readFileSync(
        resolve("node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js"),
        "utf8",
    );
    const inlinedWasmSrc = JSON.stringify(yogaWasmSrc); // safely JSON-escaped string literal

    const cjsContent = `"use strict";
// Synchronous CJS wrapper for yoga-layout — no top-level await.
// Created by scripts/patch-pkg-compat.mjs for @yao-pkg/pkg bundling.
// yoga-wasm-base64-esm.js is inlined here so this file is self-contained (works in
// esbuild bundles where __dirname no longer points to the yoga-layout package directory).

// 1. Compile WASM binary synchronously from the embedded base64 data URI
const emsSrc = ${inlinedWasmSrc};
const b64Match = emsSrc.match(/H="data:application\\/octet-stream;base64,([^"]+)"/);
if (!b64Match) throw new Error("yoga-layout-sync.cjs: embedded WASM base64 not found");
const wasmBytes = Buffer.from(b64Match[1], "base64");
const precompiled = new WebAssembly.Module(wasmBytes);

// 2. Run Emscripten IIFE in the current V8 context via new Function (no vm sandbox).
let modSrc = emsSrc
    .replace(/var _scriptDir = import\\.meta\\.url;/, 'var _scriptDir = "";')
    .replace(/^export default loadYoga;$/m, "");

const loadYogaInit = new Function(modSrc + "\\nreturn loadYoga;")();

const emsModule = {
    instantiateWasm(imports, callback) {
        const instance = new WebAssembly.Instance(precompiled, imports);
        callback(instance, precompiled);
        return instance.exports;
    },
};
loadYogaInit(emsModule); // synchronous — emsModule.Node is ready immediately

// 3. Wrap with yoga-layout's own wrapAssembly and export
const wrapAssembly = require("./dist/src/wrapAssembly.js").default;
const Yoga = wrapAssembly(emsModule);

// Export as a CJS module: \`default\` for ESM interop, plus all named keys
module.exports = Object.assign({ default: Yoga }, Yoga);
`;

    const cjsPath = resolve("node_modules/yoga-layout/yoga-layout-sync.cjs");
    writeFileSync(cjsPath, cjsContent, "utf8");

    // Also keep the ESM bundle for ink source files that are included as ESM in the snapshot
    // (they use native ESM `import`, which goes through Node's ESM loader and can handle
    // top-level await — but the bundle eliminates relative-import VFS resolution failures).
    const yogaBase = resolve("node_modules/yoga-layout/dist/src");
    // Restore originals in case a previous run patched them
    writeFileSync(
        resolve(yogaBase, "index.js"),
        `import loadYoga from '../binaries/yoga-wasm-base64-esm.js';
import wrapAssembly from "./wrapAssembly.js";
const Yoga = wrapAssembly(await loadYoga());
export default Yoga;
export * from "./generated/YGEnums.js";
//# sourceMappingURL=index.js.map
`,
    );
    const outfile = resolve("node_modules/yoga-layout/yoga-layout-bundle.mjs");
    buildSync({
        entryPoints: [resolve(yogaBase, "index.js")],
        bundle: true,
        format: "esm",
        platform: "node",
        outfile,
    });

    // Patch yoga-layout's package.json: CJS require → sync wrapper, ESM import → bundle
    const pkgJsonPath = resolve("node_modules/yoga-layout/package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    pkgJson.main = "./yoga-layout-sync.cjs";
    pkgJson.exports = {
        ".": {
            require: "./yoga-layout-sync.cjs",
            import: "./yoga-layout-bundle.mjs",
            default: "./yoga-layout-bundle.mjs",
        },
        "./load": {
            require: "./yoga-layout-sync.cjs",
            import: "./yoga-layout-bundle.mjs",
            default: "./yoga-layout-bundle.mjs",
        },
        "./package.json": "./package.json",
    };
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");

    console.log("patch-pkg-compat: created yoga-layout-sync.cjs + yoga-layout-bundle.mjs");
} catch (e) {
    console.warn("patch-pkg-compat: could not patch yoga-layout:", e.message);
}

// --- ESM-only packages: pre-bundle to CJS to avoid pkg snapshot issues ---
//
// Packages with "type":"module" and no "require" export condition cause a runtime error when
// bundled with pkg on Node 22:
//   1. pkg's ESM→CJS transformer converts the source
//   2. V8 bytecode compilation fails → pkg ships the CJS-transformed source as fallback
//   3. Node 22 sees "type":"module" in the package.json → loads the file as ESM
//   4. The CJS-transformed code has `module.exports = __toCommonJS(...)` → ReferenceError
//
// Fix: pre-bundle these packages with esbuild into a single .cjs file before pkg runs.
// The .cjs extension bypasses the "type":"module" ESM loader entirely.
//
// `import.meta.url` is replaced with a valid Windows placeholder so fileURLToPath() doesn't
// throw. Any binary-existence checks will return false → code falls back to alternatives.

const esmOnlyBundles = [
    { pkg: "clipboardy", entry: "index.js", outfile: "clipboardy-bundle.cjs" },
    { pkg: "open", entry: "index.js", outfile: "open-bundle.cjs" },
];

for (const { pkg: pkgName, entry, outfile } of esmOnlyBundles) {
    try {
        buildSync({
            entryPoints: [resolve(`node_modules/${pkgName}/${entry}`)],
            bundle: true,
            format: "cjs",
            platform: "node",
            outfile: resolve(`node_modules/${pkgName}/${outfile}`),
            external: ["node:*"],
            define: { "import.meta.url": '"file:///C:/pkg-bundled"' },
        });

        const pkgJsonPath = resolve(`node_modules/${pkgName}/package.json`);
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        pkgJson.main = `./${outfile}`;
        pkgJson.exports = {
            ".": {
                require: `./${outfile}`,
                import: `./${entry}`,
                default: `./${entry}`,
            },
        };
        writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
        console.log(`patch-pkg-compat: bundled ${pkgName} to CJS`);
    } catch (e) {
        console.warn(`patch-pkg-compat: could not bundle ${pkgName}:`, e.message);
    }
}

/**
 * Builds a standalone Windows executable using Node.js SEA (Single Executable Application).
 *
 * Why SEA instead of @yao-pkg/pkg:
 *   pkg's patched Node 22 binary has a bug — STATUS_ACCESS_VIOLATION (-1073741819) crash
 *   in V8's JIT code allocation when React's reconciler runs flushSyncWork(). This crash
 *   does NOT happen with the unmodified stock Node.js binary that SEA uses.
 *
 * Pipeline:
 *   1. esbuild bundles dist/cli.js + all node_modules into one self-contained sea-bundle.cjs
 *   2. node --experimental-sea-config generates the SEA blob
 *   3. Copy current node.exe → releases/windows/goblin-malin-win-x64.exe
 *   4. postject injects the blob into the exe
 */

import { execSync, execFileSync } from "child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSync } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── 1. esbuild bundle ────────────────────────────────────────────────────────

console.log("build-sea: bundling with esbuild...");

const bundlePath = resolve(root, "sea-bundle.cjs");

buildSync({
    entryPoints: [resolve(root, "dist/cli.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
    // Externalize only real Node.js built-ins (always available at runtime).
    // react-devtools-core is optional dev tooling never present in production.
    // ./devtools.js is an ink internal that uses top-level await — exclude it.
    external: ["react-devtools-core", "./devtools.js"],
    conditions: ["require"],
    // import.meta.url shim: in a CJS bundle import.meta is empty, so we inject
    // a valid file URL based on __filename via a module-level banner constant.
    banner: {
        js: "const __import_meta_url=require('url').pathToFileURL(__filename).href;",
    },
    define: {
        "import.meta.url": "__import_meta_url",
    },
});

const bundleSizeMB = (readFileSync(bundlePath).length / 1024 / 1024).toFixed(1);
console.log(`build-sea: bundle → sea-bundle.cjs (${bundleSizeMB} MB)`);

// ── 2. SEA blob ──────────────────────────────────────────────────────────────

const blobPath = resolve(root, "sea-prep.blob");
const seaConfigPath = resolve(root, "sea-config.json");

writeFileSync(
    seaConfigPath,
    JSON.stringify({
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
    }),
);

console.log("build-sea: generating SEA blob...");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    cwd: root,
    stdio: "inherit",
});

// ── 3. Copy node binary ──────────────────────────────────────────────────────

const outputDir = resolve(root, "releases/windows");
mkdirSync(outputDir, { recursive: true });
const outputExe = resolve(outputDir, "goblin-malin-win-x64.exe");

console.log(`build-sea: copying ${process.execPath} → ${outputExe}`);
copyFileSync(process.execPath, outputExe);

// ── 4. Find SEA fuse string ──────────────────────────────────────────────────

function findSeaFuse(nodeBinaryPath) {
    const binary = readFileSync(nodeBinaryPath);
    const text = binary.toString("latin1");
    const match = text.match(/NODE_SEA_FUSE_[a-f0-9]+/);
    if (!match) throw new Error(`SEA fuse not found in ${nodeBinaryPath}`);
    return match[0];
}

const fuse = findSeaFuse(process.execPath);
console.log(`build-sea: fuse = ${fuse}`);

// ── 5. Inject blob ───────────────────────────────────────────────────────────

console.log("build-sea: injecting SEA blob with postject...");
execSync(
    `npx postject "${outputExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${fuse}`,
    { cwd: root, stdio: "inherit" },
);

// ── 6. Cleanup temp files ────────────────────────────────────────────────────

rmSync(blobPath, { force: true });
rmSync(seaConfigPath, { force: true });
rmSync(bundlePath, { force: true });

const exeSizeMB = (readFileSync(outputExe).length / 1024 / 1024).toFixed(1);
console.log(`build-sea: ✓ ${outputExe} (${exeSizeMB} MB)`);

// Fails when a tracked source/text file is not valid UTF-8 (REL-07).
// A stray byte (e.g. a Latin-1 "é" saved by an editor) is invisible to tsc, eslint and tsx, but can break the
// production bundler. Run via `yarn check:utf8`; CI runs it before the build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|css|html|txt)$/i;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => f && TEXT_EXT.test(f));

const decoder = new TextDecoder("utf-8", { fatal: true });
const bad = [];
for (const file of files) {
    try {
        decoder.decode(readFileSync(file));
    } catch {
        bad.push(file);
    }
}

if (bad.length > 0) {
    console.error(`Not valid UTF-8:\n${bad.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
}
console.log(`UTF-8 OK (${files.length} files checked)`);

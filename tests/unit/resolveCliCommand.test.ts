import { describe, test, expect } from "vitest";
import {
    resolveCliCommand,
    isShellScript,
    type ResolveEnv,
} from "#flows/musicDownloadFlow/services/apis/resolveCliCommand";

// What npm (cmd-shim 6+) writes for a global install whose entry point is a script.
const NPM_JS_SHIM = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");

// Same shim when the package's `bin` is a native executable: the target is run directly.
const NPM_EXE_SHIM = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
].join("\r\n");

// Yarn 1's older shim style.
const YARN_SHIM = [
    "@echo off",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'IF NOT EXIST "%NODE_EXE%" SET "NODE_EXE=node"',
    '"%NODE_EXE%" "%~dp0\\..\\Data\\Global\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");

const NPM_DIR = "C:\\Users\\me\\AppData\\Roaming\\npm";
const NODE = "C:\\Program Files\\nodejs\\node.exe";

function fakeEnv(files: Record<string, string>, over: Partial<ResolveEnv> = {}): ResolveEnv {
    const norm = (p: string) => p.toLowerCase();
    const byPath = new Map(Object.entries(files).map(([p, text]) => [norm(p), text]));
    return {
        platform: "win32",
        pathEnv: `C:\\Windows\\system32;"${NPM_DIR}";C:\\Tools`,
        nodePath: NODE,
        exists: (p) => byPath.has(norm(p)),
        readText: (p) => {
            const text = byPath.get(norm(p));
            if (text === undefined) throw new Error("ENOENT");
            return text;
        },
        ...over,
    };
}

describe("resolveCliCommand", () => {
    test("runs the script an npm .cmd shim runs, through Node (the reported ENOENT/EINVAL case)", () => {
        const env = fakeEnv({
            [`${NPM_DIR}\\claude.cmd`]: NPM_JS_SHIM,
            [`${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: "",
        });
        const expected = {
            file: NODE,
            prefixArgs: [`${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
        };
        expect(resolveCliCommand("claude", env)).toEqual(expected);
        expect(resolveCliCommand(`${NPM_DIR}\\claude.cmd`, env)).toEqual(expected);
        expect(resolveCliCommand(`"${NPM_DIR}\\claude.cmd"`, env)).toEqual(expected);
    });

    test("starts the executable directly when the shim points at one", () => {
        const exe = `${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
        const env = fakeEnv({ [`${NPM_DIR}\\claude.cmd`]: NPM_EXE_SHIM, [exe]: "" });
        expect(resolveCliCommand("claude", env)).toEqual({ file: exe, prefixArgs: [] });
    });

    test("reads the older Yarn shim style, relative to the shim", () => {
        const dir = "C:\\Users\\me\\AppData\\Local\\Yarn\\bin";
        const cli =
            "C:\\Users\\me\\AppData\\Local\\Yarn\\Data\\Global\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
        const env = fakeEnv({ [`${dir}\\claude.cmd`]: YARN_SHIM, [cli]: "" }, { pathEnv: dir });
        expect(resolveCliCommand("claude", env)).toEqual({ file: NODE, prefixArgs: [cli] });
    });

    test("prefers a native claude.exe over a shim found later on PATH", () => {
        const exe = "C:\\Tools\\claude.exe";
        const env = fakeEnv({ [exe]: "", [`${NPM_DIR}\\claude.cmd`]: NPM_JS_SHIM });
        expect(resolveCliCommand("claude", env)).toEqual({ file: exe, prefixArgs: [] });
        expect(resolveCliCommand("claude.exe", env)).toEqual({ file: exe, prefixArgs: [] });
    });

    test("runs a .js entry point through Node", () => {
        const cli = "C:\\src\\claude\\cli.js";
        expect(resolveCliCommand(cli, fakeEnv({ [cli]: "" }))).toEqual({ file: NODE, prefixArgs: [cli] });
    });

    test("leaves a shim it cannot read, and a command it cannot find, unchanged", () => {
        const odd = fakeEnv({ [`${NPM_DIR}\\claude.cmd`]: "@echo hello" });
        expect(resolveCliCommand("claude", odd)).toEqual({ file: `${NPM_DIR}\\claude.cmd`, prefixArgs: [] });
        expect(resolveCliCommand("claude", fakeEnv({}))).toEqual({ file: "claude", prefixArgs: [] });
    });

    test("ignores a shim whose target file is gone", () => {
        const env = fakeEnv({ [`${NPM_DIR}\\claude.cmd`]: NPM_JS_SHIM });
        expect(resolveCliCommand("claude", env)).toEqual({ file: `${NPM_DIR}\\claude.cmd`, prefixArgs: [] });
    });

    test("does nothing off Windows", () => {
        const env = fakeEnv({ [`${NPM_DIR}\\claude.cmd`]: NPM_JS_SHIM }, { platform: "linux" });
        expect(resolveCliCommand("claude", env)).toEqual({ file: "claude", prefixArgs: [] });
    });
});

describe("isShellScript", () => {
    test("is true only for .cmd and .bat", () => {
        expect(isShellScript("C:\\x\\claude.CMD")).toBe(true);
        expect(isShellScript("C:\\x\\claude.bat")).toBe(true);
        expect(isShellScript("C:\\x\\claude.exe")).toBe(false);
        expect(isShellScript("claude")).toBe(false);
    });
});

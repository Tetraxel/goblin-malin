import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { spawn } from "child_process";
import { EXTENSION_API_VERSION } from "#constants";
import { checkManifest, getExtensionsDir, MANIFEST_FILE, NAME_PATTERN } from "./manifest";
import { hashFolder, readTrustRecord, writeTrustEntry } from "./trust";

/**
 * `goblin-malin ext …`: manages the extensions folder without opening the app (P34, T34.11). Installing never
 * trusts: the app still asks before an extension's first load.
 */

type Out = { log: (line: string) => void; error: (line: string) => void };
const defaultOut: Out = {
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
};

function run(command: string, args: string[], cwd?: string): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
        child.on("error", () => resolve(127));
        child.on("close", (code) => resolve(code ?? 1));
    });
}

async function exists(p: string): Promise<boolean> {
    return fs
        .access(p)
        .then(() => true)
        .catch(() => false);
}

async function ask(question: string): Promise<boolean> {
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
}

async function list(out: Out, root: string): Promise<number> {
    const trust = await readTrustRecord();
    let entries: string[] = [];
    try {
        entries = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
        /* no folder yet */
    }
    if (entries.length === 0) {
        out.log(`No extension in ${root}.`);
        out.log("Add one with: goblin-malin ext add <folder | git URL>");
        return 0;
    }
    for (const dir of entries.sort()) {
        const folder = path.join(root, dir);
        let line: string;
        try {
            const check = checkManifest(
                JSON.parse(await fs.readFile(path.join(folder, MANIFEST_FILE), "utf-8")),
                folder
            );
            if (!check.ok) {
                line = `${dir}  ✗ ${check.error}`;
            } else {
                const m = check.manifest;
                const answer = trust[m.name];
                let state = "not allowed yet (asked at the next start)";
                if (m.apiVersion !== EXTENSION_API_VERSION)
                    state = `needs API v${m.apiVersion} (this app: v${EXTENSION_API_VERSION})`;
                else if (answer?.answer === "off") state = "off";
                else if (answer?.answer === "load") {
                    state = answer.hash === (await hashFolder(folder)) ? "on" : "changed since allowed (asked again)";
                }
                line = `${m.name} ${m.version}  ${state}${m.description ? `\n    ${m.description}` : ""}`;
            }
        } catch (error) {
            line = `${dir}  ✗ ${error instanceof Error ? error.message : error}`;
        }
        out.log(line);
    }
    return 0;
}

const isGitUrl = (s: string) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(s) || s.endsWith(".git");

async function add(out: Out, root: string, source: string | undefined, force: boolean): Promise<number> {
    if (!source) {
        out.error("Usage: goblin-malin ext add <folder | git URL> [--force]");
        return 2;
    }
    await fs.mkdir(root, { recursive: true });
    const staging = path.join(root, `.adding-${Date.now()}`);
    try {
        if (isGitUrl(source)) {
            out.log(`Cloning ${source}…`);
            if ((await run("git", ["clone", "--depth", "1", source, staging])) !== 0) {
                out.error("git clone failed (is git installed, and the address right?)");
                return 1;
            }
            await fs.rm(path.join(staging, ".git"), { recursive: true, force: true });
        } else {
            const from = path.resolve(source);
            if (!(await exists(path.join(from, MANIFEST_FILE)))) {
                out.error(`${from} has no ${MANIFEST_FILE}: it is not an extension folder`);
                return 1;
            }
            await fs.cp(from, staging, {
                recursive: true,
                filter: (src) => !src.split(path.sep).includes("node_modules") && !src.split(path.sep).includes(".git"),
            });
        }
        const check = checkManifest(JSON.parse(await fs.readFile(path.join(staging, MANIFEST_FILE), "utf-8")), staging);
        if (!check.ok) {
            out.error(`Not installed: ${check.error}`);
            return 1;
        }
        const name = check.manifest.name;
        const target = path.join(root, name);
        if (await exists(target)) {
            if (!force) {
                out.error(`An extension named "${name}" is already installed. Use --force to replace it.`);
                return 1;
            }
            await fs.rm(target, { recursive: true, force: true });
        }
        await fs.rename(staging, target);
        if (await exists(path.join(target, "package.json"))) {
            const pkg = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf-8")) as {
                dependencies?: Record<string, string>;
            };
            if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
                out.log("Installing its dependencies (npm install --omit=dev)…");
                if ((await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], target)) !== 0) {
                    out.error("npm install failed: the extension may not load. Run it again in " + target);
                }
            }
        }
        if (check.manifest.apiVersion !== EXTENSION_API_VERSION) {
            out.error(
                `Warning: it was written for API v${check.manifest.apiVersion}; this app has v${EXTENSION_API_VERSION}. It will not load.`
            );
        }
        out.log(`Installed ${name} ${check.manifest.version} in ${target}.`);
        out.log("Goblin Malin asks before loading it, at its next start.");
        return 0;
    } catch (error) {
        out.error(`Not installed: ${error instanceof Error ? error.message : error}`);
        return 1;
    } finally {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
}

async function remove(out: Out, root: string, name: string | undefined, yes: boolean): Promise<number> {
    if (!name || !NAME_PATTERN.test(name)) {
        out.error("Usage: goblin-malin ext remove <name> [--yes]");
        return 2;
    }
    const target = path.join(root, name);
    if (!(await exists(target))) {
        out.error(`No extension "${name}" in ${root}`);
        return 1;
    }
    if (!yes && !(await ask(`Delete the folder ${target}? Its settings and the tracks it touched are kept. [y/N] `))) {
        out.log("Nothing removed.");
        return 1;
    }
    await fs.rm(target, { recursive: true, force: true });
    await writeTrustEntry(name, undefined);
    out.log(`Removed ${name}. Its settings stay in settings.json, in case it comes back.`);
    return 0;
}

/** The starting files of a new extension. */
export function scaffoldFiles(name: string): Record<string, string> {
    const title = name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    return {
        [MANIFEST_FILE]:
            JSON.stringify(
                {
                    name,
                    displayName: title,
                    version: "0.1.0",
                    apiVersion: EXTENSION_API_VERSION,
                    entry: "index.js",
                    description: "What it does, in one sentence.",
                    settings: {
                        greeting: { kind: "textInput", label: "Greeting", defaultValue: "Hello" },
                    },
                },
                null,
                2
            ) + "\n",
        "index.js": `// @ts-check
/**
 * ${title}: a Goblin Malin extension. See docs/extensions.md in the Goblin Malin repository.
 * Work on it with:  goblin-malin --extension .
 *
 * @param {import("goblin-malin/extension-api").GoblinApi} goblin
 */
export default function activate(goblin) {
    goblin.actions.register({
        id: "hello",
        label: "Say hello",
        description: "Shows how many tracks are in the list",
        run: async () => {
            const tracks = goblin.tasks.list({ kind: "track" });
            await goblin.dialog.notify(
                "${title}",
                \`\${goblin.settings.get("greeting")}! \${tracks.length} track(s) in the list.\`
            );
        },
    });

    const off = goblin.on("track.saved", ({ track, path }) => {
        goblin.log.info(\`Saved \${track.title ?? track.url} to \${path}\`);
    });

    // Called when the app closes.
    return () => off();
}
`,
        "package.json":
            JSON.stringify(
                {
                    name: `goblin-malin-extension-${name}`,
                    version: "0.1.0",
                    private: true,
                    type: "module",
                    devDependencies: { "goblin-malin": "*" },
                },
                null,
                2
            ) + "\n",
        "README.md": `# ${title}\n\nA [Goblin Malin](https://github.com/Tetraxel/goblin-malin) extension.\n\n- Try it: \`goblin-malin --extension .\`\n- Install it: \`goblin-malin ext add .\`\n`,
    };
}

async function scaffold(out: Out, name: string | undefined, folder: string | undefined): Promise<number> {
    if (!name || !NAME_PATTERN.test(name)) {
        out.error("Usage: goblin-malin ext new <name> [folder]   (name: lower case letters, digits and dashes)");
        return 2;
    }
    const target = path.resolve(folder ?? name);
    if (await exists(path.join(target, MANIFEST_FILE))) {
        out.error(`${target} already holds an extension`);
        return 1;
    }
    await fs.mkdir(target, { recursive: true });
    for (const [file, content] of Object.entries(scaffoldFiles(name))) {
        await fs.writeFile(path.join(target, file), content, "utf-8");
    }
    out.log(`Created ${target}.`);
    out.log(`Try it with:  goblin-malin --extension ${path.relative(process.cwd(), target) || "."}`);
    return 0;
}

/** Runs `goblin-malin ext <args>`; resolves with the exit code. */
export async function runExtCommand(args: string[], out: Out = defaultOut, root = getExtensionsDir()): Promise<number> {
    const [command, ...rest] = args;
    const flags = new Set(rest.filter((a) => a.startsWith("--")));
    const positional = rest.filter((a) => !a.startsWith("--"));
    switch (command) {
        case "list":
        case "ls":
            return list(out, root);
        case "add":
        case "install":
            return add(out, root, positional[0], flags.has("--force"));
        case "remove":
        case "rm":
        case "uninstall":
            return remove(out, root, positional[0], flags.has("--yes") || flags.has("-y"));
        case "new":
        case "create":
            return scaffold(out, positional[0], positional[1]);
        default:
            out.error(
                "Usage: goblin-malin ext list\n" +
                    "       goblin-malin ext add <folder | git URL> [--force]\n" +
                    "       goblin-malin ext remove <name> [--yes]\n" +
                    "       goblin-malin ext new <name> [folder]\n" +
                    `Extensions live in ${root}.`
            );
            return command ? 2 : 0;
    }
}

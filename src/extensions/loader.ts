import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { EXTENSION_API_VERSION } from "#constants";
import { globalLogger } from "#base/logger/logger";
import { appReady } from "#base/appReady";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { registerExitHook } from "#base/exitHooks";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { withTimeout } from "#utils/timeout";
import { musicEvents } from "#flows/musicDownloadFlow/appEvents";
import { type Activate, type ActivateResult } from "./api/types";
import { adoptExtensionSecrets, createGoblinApi, EXTENSION_SECRET_PREFIX, extensionLogger } from "./api/createApi";
import { appSecrets } from "#base/appSecrets";
import { extensionStore, newRecord, type ExtensionRecord } from "./extensionStore";
import { checkManifest, getExtensionsDir, MANIFEST_FILE } from "./manifest";
import { hashFolder, readTrustRecord, writeTrustEntry, type TrustRecord } from "./trust";

/** How long `activate` may take before the extension counts as failed. */
export const ACTIVATE_TIMEOUT_MS = 5_000;
/** How long the `app.exit` handlers and `dispose()` get, all together. */
const EXIT_MS = 1_800;

const logger = globalLogger.createChild({ service: "Extensions" });

export type LoadOptions = {
    /** Folders loaded without the trust record (`--extension <path>`, an author working on one). */
    devPaths?: string[];
    /** No extension at all for this run (`--no-extensions`, `GOBLIN_NO_EXTENSIONS=1`). */
    disabled?: boolean;
    /** Where to look (tests); default `<data folder>/extensions`. */
    folder?: string;
    /** The trust file (tests). */
    trustFile?: string;
};

let options: LoadOptions = {};
let exitHookRegistered = false;
let fallbackRegistered = false;

/** Whether `GOBLIN_NO_EXTENSIONS` / `--no-extensions` asks for a run without extensions. */
export function extensionsDisabledByEnv(argv: readonly string[] = process.argv.slice(2)): boolean {
    const env = process.env.GOBLIN_NO_EXTENSIONS;
    return argv.includes("--no-extensions") || (env !== undefined && env !== "" && env !== "0");
}

/**
 * The folders given with `--extension <path>` (repeatable), and in `GOBLIN_EXTENSION` (several separated like PATH
 * entries: `:`, or `;` on Windows).
 */
export function devExtensionPaths(
    argv: readonly string[] = process.argv.slice(2),
    env: string | undefined = process.env.GOBLIN_EXTENSION
): string[] {
    const paths: string[] = (env ?? "")
        .split(path.delimiter)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => path.resolve(p));
    argv.forEach((arg, i) => {
        if (arg === "--extension" && argv[i + 1]) paths.push(path.resolve(argv[i + 1]));
        else if (arg.startsWith("--extension=")) paths.push(path.resolve(arg.slice("--extension=".length)));
    });
    return [...new Set(paths)];
}

async function readManifest(folder: string): Promise<ReturnType<typeof checkManifest>> {
    let text: string;
    try {
        text = await fs.readFile(path.join(folder, MANIFEST_FILE), "utf-8");
    } catch {
        return { ok: false, error: `no ${MANIFEST_FILE} in the folder` };
    }
    try {
        return checkManifest(JSON.parse(text), folder);
    } catch (error) {
        return {
            ok: false,
            error: `${MANIFEST_FILE} is not valid JSON (${error instanceof Error ? error.message : error})`,
        };
    }
}

/** Every extension folder under the extensions folder (each sub-folder holding an `extension.json`). */
async function listFolders(root: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .map((e) => path.join(root, e.name))
            .sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") logger.warn(`Could not list ${root}`, { error });
        return [];
    }
}

/** What an extension's folder holds, as a record (state still to decide). */
async function inspect(folder: string, development: boolean): Promise<ExtensionRecord> {
    const check = await readManifest(folder);
    if (!check.ok) {
        return newRecord({ name: path.basename(folder), folder, development, state: "invalid", reason: check.error });
    }
    const m = check.manifest;
    const record = newRecord({
        name: m.name,
        displayName: m.displayName,
        version: m.version,
        description: m.description,
        apiVersion: m.apiVersion,
        folder,
        entry: m.entry,
        development,
        state: "untrusted",
        settings: { ...(m.settings ?? {}) },
    });
    if (m.apiVersion !== EXTENSION_API_VERSION) {
        record.state = "incompatible";
        record.reason =
            m.apiVersion > EXTENSION_API_VERSION
                ? `needs API v${m.apiVersion}, this app has v${EXTENSION_API_VERSION}: update Goblin Malin`
                : `written for API v${m.apiVersion}, this app has v${EXTENSION_API_VERSION}: update the extension`;
    }
    return record;
}

function disposeOf(result: ActivateResult): (() => void | Promise<void>) | undefined {
    if (typeof result === "function") return result;
    if (result && typeof result === "object" && typeof result.dispose === "function") return result.dispose;
    return undefined;
}

/**
 * Imports the extension's entry and runs its `activate(goblin)`, within {@link ACTIVATE_TIMEOUT_MS}. Never throws: a
 * failure is recorded on the extension (whatever it registered before failing stays for this run; a restart without
 * it is clean).
 */
export async function activateExtension(record: ExtensionRecord): Promise<boolean> {
    const started = performance.now();
    extensionStore.update(record.name, { state: "loading", reason: undefined });
    const log = extensionLogger(record.name);
    try {
        adoptExtensionSecrets(record.name);
        const entry = path.resolve(record.folder, record.entry ?? "index.js");
        // The hash in the URL: files changed since the last import of this run are imported anew, not from Node's cache.
        const url = `${pathToFileURL(entry).href}${record.hash ? `?v=${record.hash.slice(-12)}` : ""}`;
        const module = (await withTimeout(import(url), ACTIVATE_TIMEOUT_MS, `importing ${record.name}`)) as {
            default?: unknown;
            activate?: unknown;
        };
        const activate = (typeof module.default === "function" ? module.default : module.activate) as
            Activate | undefined;
        if (typeof activate !== "function") {
            throw new Error(
                `${record.entry} exports no activate function (export default function activate(goblin) { … })`
            );
        }
        const goblin = createGoblinApi(record);
        const result = await withTimeout(
            Promise.resolve().then(() => activate(goblin)),
            ACTIVATE_TIMEOUT_MS,
            `${record.name}'s activate()`
        );
        const ms = Math.round(performance.now() - started);
        extensionStore.update(record.name, { state: "loaded", dispose: disposeOf(result), loadedInMs: ms });
        const line = `Loaded ${record.name} ${record.version ?? ""} in ${ms} ms${record.development ? " (development)" : ""}`;
        extensionStore.appendLog(record.name, { at: new Date().toISOString(), level: "info", message: line });
        log.info(line);
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        extensionStore.update(record.name, { state: "failed", reason });
        extensionStore.appendLog(record.name, { at: new Date().toISOString(), level: "error", message: reason });
        log.error(`Could not load ${record.name}: ${reason}`, { error });
        return false;
    }
}

/** Closing the app: every loaded extension hears `app.exit`, then its `dispose()` runs (together, in a short time). */
function registerExit(): void {
    if (exitHookRegistered) return;
    exitHookRegistered = true;
    registerExitHook(async () => {
        await musicEvents.emitAndWait("app.exit", {}, EXIT_MS / 2);
        const disposals = extensionStore
            .list()
            .filter((r) => r.state === "loaded" && r.dispose)
            .map(async (r) => {
                try {
                    await r.dispose!();
                } catch (error) {
                    extensionLogger(r.name).warn(`dispose() failed: ${error instanceof Error ? error.message : error}`);
                }
            });
        await Promise.race([
            Promise.allSettled(disposals),
            new Promise((resolve) => setTimeout(resolve, EXIT_MS / 2).unref?.()),
        ]);
    });
}

/**
 * A provider key saved in a session whose extension is not loaded (off, failed, removed) still shows something that
 * says why, instead of a bare key: its tracks keep their data, it only cannot be fetched again (P34, T34.9).
 */
function registerDisplayFallback(): void {
    if (fallbackRegistered) return;
    fallbackRegistered = true;
    providerDisplayRegistry.setFallback((key) => {
        const dot = key.indexOf(".");
        if (dot <= 0) return undefined;
        const owner = key.slice(0, dot);
        const record = extensionStore.get(owner);
        if (record?.state === "loaded") return undefined;
        return {
            label: `${key.slice(dot + 1)} (extension "${record?.displayName ?? owner}" is not loaded)`,
            acronym: key.slice(dot + 1).toUpperCase(),
        };
    });
}

/** Errors of the extensions' event handlers go to their own log, named after them. */
function registerEventErrors(): void {
    musicEvents.setErrorReporter(({ owner, event, error, timedOut }) => {
        const message = `${timedOut ? "Took too long on" : "Failed on"} "${event}": ${error instanceof Error ? error.message : error}`;
        extensionStore.appendLog(owner, { at: new Date().toISOString(), level: "error", message });
        extensionLogger(owner).error(message);
    });
}

/**
 * Finds the extensions and loads the ones that are on and trusted (and every `--extension` folder). Called by
 * `start()` after `initMusicApp()` and before the first render. Never throws: an extension that breaks is recorded as
 * failed and the app starts without it. The trust questions come after the first render ({@link askPendingTrust}).
 */
export async function loadExtensions(opts: LoadOptions = {}): Promise<void> {
    options = opts;
    // Every extension's credentials leave the environment at once, loaded or not: a program the app starts must never
    // inherit them, whatever becomes of their extension.
    appSecrets.adopt(Object.keys(process.env).filter((k) => k.startsWith(EXTENSION_SECRET_PREFIX)));
    registerEventErrors();
    registerDisplayFallback();
    const root = opts.folder ?? getExtensionsDir();
    try {
        const devPaths = opts.devPaths ?? [];
        const installed = await listFolders(root);
        const trust: TrustRecord = await readTrustRecord(opts.trustFile);
        const records: ExtensionRecord[] = [];
        for (const folder of devPaths) records.push(await inspect(folder, true));
        for (const folder of installed) {
            const record = await inspect(folder, false);
            // A folder loaded with --extension takes the name: the installed copy waits for the next normal start.
            if (records.some((r) => r.name === record.name)) {
                record.state = "off";
                record.reason = "a development copy (--extension) is loaded instead";
                record.name = `${record.name}@installed`;
            }
            records.push(record);
        }

        for (const record of records) {
            extensionStore.add(record);
            if (opts.disabled && record.state !== "invalid") {
                record.state = "disabled";
                record.reason = "every extension is off for this run (--no-extensions)";
                continue;
            }
            if (record.state !== "untrusted") continue;
            if (record.development) {
                logger.warn(
                    `Loading the extension "${record.name}" from ${record.folder} without asking (--extension): never use this for an extension you did not write`
                );
                await activateExtension(record);
                continue;
            }
            const answer = trust[record.name];
            if (answer?.answer === "off") {
                extensionStore.update(record.name, { state: "off" });
                continue;
            }
            const hash = await hashFolder(record.folder);
            extensionStore.update(record.name, { hash });
            if (answer?.answer === "load" && answer.hash === hash) {
                await activateExtension(record);
            } else {
                extensionStore.update(record.name, { state: "untrusted", changed: answer?.answer === "load" });
            }
        }
    } catch (error) {
        logger.error("Could not load the extensions", { error });
    }
    registerExit();
    const loaded = extensionStore.describeLoaded();
    if (loaded.length > 0) logger.info(`Extensions loaded: ${loaded.join(", ")}`);
    // Asked once the app is on screen (no dialog can be shown before).
    appReady.whenReady(() => void askPendingTrust());
}

/** The question asked before an extension's first load, and again when its files changed. Safe button first. */
async function askTrust(record: ExtensionRecord): Promise<"load" | "never" | "later"> {
    const message = [
        `${record.name} ${record.version ?? ""} · ${record.folder}`,
        record.description ?? "",
        "",
        record.changed
            ? "Its files changed since you allowed it. Load the new version only if you know where the change comes from."
            : "",
        "An extension runs inside Goblin Malin with the same rights: it can read and change your files, use the network and read your provider credentials. Only load extensions from people you trust.",
    ]
        .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
        .join("\n");
    const answer = await dialogBridge.confirm({
        title: `Load the extension "${record.displayName}"?`,
        message,
        choices: [
            { label: "Not now", tone: "primary" },
            { label: "Never", tone: "muted" },
            { label: "Load it", tone: "danger" },
        ],
    });
    return answer === 2 ? "load" : answer === 1 ? "never" : "later";
}

/** Records the user's yes and loads the extension at once (its providers reach the tracks added from now on). */
export async function trustAndLoad(record: ExtensionRecord): Promise<boolean> {
    const hash = record.hash ?? (await hashFolder(record.folder));
    extensionStore.update(record.name, { hash, changed: false, wantedOn: true });
    await writeTrustEntry(record.name, { answer: "load", hash, at: new Date().toISOString() }, options.trustFile);
    if (record.state === "loaded") return true;
    return activateExtension(record);
}

/** Records "off" (Never, or the switch in Settings). It stays loaded until the app restarts, if it was. */
export async function turnOff(record: ExtensionRecord): Promise<void> {
    const hash = record.hash ?? (await hashFolder(record.folder));
    await writeTrustEntry(record.name, { answer: "off", hash, at: new Date().toISOString() }, options.trustFile);
    if (record.state !== "loaded") extensionStore.update(record.name, { state: "off", wantedOn: false });
    else extensionStore.update(record.name, { wantedOn: false, reason: "turned off: it goes at the next start" });
}

/**
 * The switch turned on in Settings: the question is asked again (with what the extension can do), whatever was
 * answered before. A yes loads it at once.
 */
export async function askTrustFromSettings(record: ExtensionRecord): Promise<void> {
    if (record.state === "loaded") {
        await trustAndLoad(record);
        return;
    }
    record.hash = await hashFolder(record.folder);
    const answer = await askTrust(record);
    if (answer === "load") await trustAndLoad(record);
    else if (answer === "never") await turnOff(record);
}

/** Asks about every extension still waiting for an answer, one at a time. "Not now" asks again at the next start. */
export async function askPendingTrust(): Promise<void> {
    for (const record of extensionStore.list()) {
        if (record.state !== "untrusted" || record.development) continue;
        const answer = await askTrust(record);
        if (answer === "load") await trustAndLoad(record);
        else if (answer === "never") await turnOff(record);
        else logger.info(`The extension "${record.name}" waits for an answer (asked again at the next start)`);
    }
}

/** Tests. */
export function resetExtensionLoader(): void {
    options = {};
    extensionStore.clear();
}

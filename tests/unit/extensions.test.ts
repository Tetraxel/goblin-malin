import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Extensions (P34): the loader, trust, the `goblin` object, events, providers and what is left when an extension is
 * gone. Extensions are written to a throwaway folder as plain ES modules and loaded through the real loader.
 */

type Loader = typeof import("#extensions/loader");
type Store = typeof import("#extensions/extensionStore");
let loader: Loader;
let store: Store["extensionStore"];
let root: string;
let trustFile: string;

const EXT_SOURCE = (body: string) => `export default function activate(goblin) {\n${body}\n}\n`;

function writeExtension(name: string, body: string, manifest: Record<string, unknown> = {}, dir = root): string {
    const folder = path.join(dir, name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
        path.join(folder, "extension.json"),
        JSON.stringify({ name, version: "1.0.0", apiVersion: 1, ...manifest })
    );
    fs.writeFileSync(path.join(folder, "index.js"), EXT_SOURCE(body));
    return folder;
}

async function trust(name: string): Promise<void> {
    const { hashFolder, writeTrustEntry } = await import("#extensions/trust");
    await writeTrustEntry(name, { answer: "load", hash: await hashFolder(path.join(root, name)), at: "" }, trustFile);
}

/** A symbolic link, or false where it cannot be made (Windows without the right to). */
function trySymlink(target: string, linkPath: string): boolean {
    try {
        fs.symlinkSync(target, linkPath);
        return true;
    } catch {
        return false;
    }
}

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    loader = await import("#extensions/loader");
    store = (await import("#extensions/extensionStore")).extensionStore;
});

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-"));
    trustFile = path.join(root, "..", `${path.basename(root)}-trust.json`);
    loader.resetExtensionLoader();
});

afterEach(async () => {
    const { actionsMenuRegistry } = await import("#base/actionsMenu");
    actionsMenuRegistry.clear();
    const { resetMusicEvents } = await import("#flows/musicDownloadFlow/appEvents");
    resetMusicEvents();
});

const load = (opts: Partial<import("#extensions/loader").LoadOptions> = {}) =>
    loader.loadExtensions({ folder: root, trustFile, ...opts });

describe("manifest", () => {
    test("a good manifest passes, with defaults filled in", async () => {
        const { checkManifest } = await import("#extensions/manifest");
        const check = checkManifest({ name: "my-ext", version: "1.2.3", apiVersion: 1 }, "/x/my-ext");
        expect(check.ok && check.manifest).toMatchObject({ name: "my-ext", displayName: "my-ext", entry: "index.js" });
    });

    test.each([
        [{ name: "My Ext", version: "1.0.0", apiVersion: 1 }, "name"],
        [{ name: "my-ext", version: "one", apiVersion: 1 }, "version"],
        [{ name: "my-ext", version: "1.0.0" }, "apiVersion"],
        [{ name: "my-ext", version: "1.0.0", apiVersion: 1, entry: "../evil.js" }, "inside"],
        [
            {
                name: "my-ext",
                version: "1.0.0",
                apiVersion: 1,
                settings: { a: { kind: "select", label: "A", defaultValue: "x", options: ["y"] } },
            },
            "one of its options",
        ],
    ])("a bad manifest is refused (%j)", async (raw, why) => {
        const { checkManifest } = await import("#extensions/manifest");
        const check = checkManifest(raw, "/x/my-ext");
        expect(check.ok).toBe(false);
        expect(!check.ok && check.error).toContain(why);
    });
});

describe("loading and trust", () => {
    test("only an allowed extension whose files did not change is loaded; the others wait or say why", async () => {
        writeExtension("trusted", `goblin.log.info("hi");`);
        writeExtension("new-one", `throw new Error("must not run");`);
        writeExtension("changed", `goblin.log.info("v1");`);
        writeExtension("too-new", ``, { apiVersion: 99 });
        fs.mkdirSync(path.join(root, "broken"));
        fs.writeFileSync(path.join(root, "broken", "extension.json"), "{ nope");
        await trust("trusted");
        await trust("changed");
        fs.writeFileSync(path.join(root, "changed", "index.js"), EXT_SOURCE(`goblin.log.info("v2");`));

        await load();

        expect(store.get("trusted")?.state).toBe("loaded");
        expect(store.get("new-one")?.state).toBe("untrusted");
        expect(store.get("changed")).toMatchObject({ state: "untrusted", changed: true });
        expect(store.get("too-new")).toMatchObject({ state: "incompatible" });
        expect(store.get("too-new")?.reason).toContain("update Goblin Malin");
        expect(store.get("broken")).toMatchObject({ state: "invalid" });
        expect(store.get("trusted")?.log.some((l) => l.message === "hi")).toBe(true);
    });

    test("an extension that throws, or exports nothing to run, fails alone: the others load", async () => {
        writeExtension("bad", `throw new Error("boom");`);
        const noActivate = writeExtension("no-activate", ``);
        fs.writeFileSync(path.join(noActivate, "index.js"), "export const x = 1;\n");
        writeExtension("good", `goblin.actions.register({ id: "a", label: "A", description: "", run() {} });`);
        for (const n of ["bad", "no-activate", "good"]) await trust(n);

        await load();

        expect(store.get("bad")).toMatchObject({ state: "failed", reason: "boom" });
        expect(store.get("no-activate")?.reason).toContain("exports no activate");
        expect(store.get("good")?.state).toBe("loaded");
    });

    test("an answer of 'off' keeps it off; --no-extensions keeps every one off", async () => {
        writeExtension("offed", ``);
        const { writeTrustEntry } = await import("#extensions/trust");
        await writeTrustEntry("offed", { answer: "off", hash: "x", at: "" }, trustFile);
        writeExtension("other", ``);
        await trust("other");

        await load({ disabled: true });
        expect(store.get("other")?.state).toBe("disabled");

        loader.resetExtensionLoader();
        await load();
        expect(store.get("offed")?.state).toBe("off");
        expect(store.get("other")?.state).toBe("loaded");
    });

    test("--extension loads a folder without the trust record, and wins over an installed copy", async () => {
        const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-dev-"));
        const dev = writeExtension(
            "mine",
            `goblin.log.info(goblin.extension.development ? "dev" : "installed");`,
            {},
            devRoot
        );
        writeExtension("mine", ``);

        await load({ devPaths: [dev] });

        expect(store.get("mine")).toMatchObject({ state: "loaded", development: true });
        expect(store.get("mine")?.log.map((l) => l.message)).toContain("dev");
        expect(store.get("mine@installed")?.state).toBe("off");
    });

    test("the trust dialog: Load it records the hash and loads at once; Never records off; nobody answering changes nothing", async () => {
        writeExtension("ask-me", `goblin.log.info("loaded");`);
        writeExtension("never-me", ``);
        await load();
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        const answers = [2, 1];
        dialogBridge.setConfirmOpener((_dialog, resolve) => resolve(answers.shift() ?? null));
        try {
            await loader.askPendingTrust();
        } finally {
            dialogBridge.setConfirmOpener(null);
        }
        expect(store.get("ask-me")?.state).toBe("loaded");
        expect(store.get("never-me")?.state).toBe("off");
        const { readTrustRecord, hashFolder } = await import("#extensions/trust");
        const record = await readTrustRecord(trustFile);
        expect(record["ask-me"]).toMatchObject({ answer: "load", hash: await hashFolder(path.join(root, "ask-me")) });
        expect(record["never-me"]?.answer).toBe("off");
    });

    test("the folder hash follows every file, and node_modules by package (name and package.json), not by its code", async () => {
        const { hashFolder } = await import("#extensions/trust");
        const folder = writeExtension("hashed", ``);
        const before = await hashFolder(folder);
        fs.mkdirSync(path.join(folder, "node_modules", "dep"), { recursive: true });
        fs.writeFileSync(path.join(folder, "node_modules", "dep", "package.json"), '{"name":"dep","version":"1.0.0"}');
        const withDep = await hashFolder(folder);
        expect(withDep).not.toBe(before); // a package was installed
        fs.writeFileSync(path.join(folder, "node_modules", "dep", "index.js"), "x"); // a file inside a package: not read
        expect(await hashFolder(folder)).toBe(withDep);
        fs.writeFileSync(path.join(folder, "node_modules", "dep", "package.json"), '{"name":"dep","version":"1.0.1"}');
        expect(await hashFolder(folder)).not.toBe(withDep); // an update
        fs.writeFileSync(path.join(folder, "package-lock.json"), "{}");
        expect(await hashFolder(folder)).not.toBe(withDep);
    });

    test("a link is hashed by where it points; one that leaves the folder is refused, for that extension only", async () => {
        const { hashFolder, ExtensionFolderError } = await import("#extensions/trust");
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-outside-"));
        fs.writeFileSync(path.join(outside, "evil.js"), "export default function activate() {}\n");
        const linky = writeExtension("linky", ``);
        fs.rmSync(path.join(linky, "index.js"));
        if (!trySymlink(path.join(outside, "evil.js"), path.join(linky, "index.js"))) return; // no right to link here

        await expect(hashFolder(linky)).rejects.toBeInstanceOf(ExtensionFolderError);

        // Inside the folder, retargeting a link changes the hash although no file does.
        const inner = writeExtension("inner", ``);
        fs.writeFileSync(path.join(inner, "a.js"), "export const a = 1;\n");
        fs.writeFileSync(path.join(inner, "b.js"), "export const b = 1;\n");
        fs.symlinkSync("a.js", path.join(inner, "link.js"));
        const toA = await hashFolder(inner);
        fs.rmSync(path.join(inner, "link.js"));
        fs.symlinkSync("b.js", path.join(inner, "link.js"));
        expect(await hashFolder(inner)).not.toBe(toA);

        // The bad one fails alone; the others load.
        writeExtension("fine", `goblin.log.info("ok");`);
        await trust("fine");
        await load();
        expect(store.get("linky")?.state).toBe("failed");
        expect(store.get("linky")?.reason).toContain("outside the extension's folder");
        expect(store.get("fine")?.state).toBe("loaded");
    });

    test("an entry file that is a link out of the folder is not imported, even with a hash that matches", async () => {
        const { newRecord } = await import("#extensions/extensionStore");
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-outside-"));
        fs.writeFileSync(
            path.join(outside, "evil.js"),
            "globalThis.__evilRan = true;\nexport default function activate() {}\n"
        );
        const folder = writeExtension("entry-link", ``);
        fs.rmSync(path.join(folder, "index.js"));
        if (!trySymlink(path.join(outside, "evil.js"), path.join(folder, "index.js"))) return;
        const record = newRecord({
            name: "entry-link",
            folder,
            development: false,
            state: "untrusted",
            entry: "index.js",
        });
        store.add(record);
        expect(await loader.activateExtension(record)).toBe(false);
        expect(store.get("entry-link")?.reason).toContain("outside its folder");
        expect((globalThis as { __evilRan?: boolean }).__evilRan).toBeUndefined();
    });

    test("the answer cannot be changed for a copy shadowed by --extension, nor in a run with --no-extensions", async () => {
        const { buildExtensionSettingsItems, emptyExtensionsDraft } = await import("#extensions/settingsItems");
        const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-dev-"));
        const dev = writeExtension("twin", ``, {}, devRoot);
        writeExtension("twin", ``);
        await load({ devPaths: [dev] });
        const shadowed = store.get("twin@installed")!;
        expect(shadowed.shadowed).toBe(true);
        const switches = (): number =>
            buildExtensionSettingsItems(emptyExtensionsDraft(), () => {}).filter(
                (i) => i.kind === "checkbox" && i.label === "On"
            ).length;
        expect(switches()).toBe(0); // the development copy and the shadowed one have none
        expect(await loader.trustAndLoad(shadowed)).toBe(false);
        expect(shadowed.state).toBe("off");

        loader.resetExtensionLoader();
        writeExtension("alone", `throw new Error("must not run");`);
        await load({ disabled: true });
        const alone = store.get("alone")!;
        expect(alone.state).toBe("disabled");
        expect(switches()).toBe(0);
        expect(await loader.trustAndLoad(alone)).toBe(false);
        await loader.askTrustFromSettings(alone);
        expect(store.get("alone")?.state).toBe("disabled");
    });
});

describe("the goblin object", () => {
    test("Actions items are prefixed, and a throw in run or unavailableReason is contained", async () => {
        writeExtension(
            "acts",
            `goblin.actions.register({ id: "go", label: "Go", description: "d", unavailableReason: () => { throw new Error("nope"); }, run() { throw new Error("bad run"); } });`
        );
        await trust("acts");
        await load();
        const { actionsMenuRegistry } = await import("#base/actionsMenu");
        const item = actionsMenuRegistry.list().find((i) => i.id === "acts.go");
        expect(item).toBeDefined();
        expect(item!.unavailableReason!()).toBe("This extension failed: nope");
        await expect(item!.run()).resolves.toBeUndefined();
        expect(store.get("acts")?.log.some((l) => l.level === "error" && l.message.includes("bad run"))).toBe(true);
        expect(store.get("acts")?.contributions.actions).toEqual(["acts.go"]);
    });

    test("settings live under extensions.<name>, with the declared defaults, and survive the extension being gone", async () => {
        writeExtension(
            "settler",
            `goblin.settings.set("folder", "/music"); goblin.log.info(String(goblin.settings.get("on")) + " " + goblin.settings.get("folder"));`,
            {
                settings: {
                    on: { kind: "checkbox", label: "On", defaultValue: true },
                    folder: { kind: "textInput", label: "F", defaultValue: "" },
                },
            }
        );
        await trust("settler");
        await load();
        expect(store.get("settler")?.log.map((l) => l.message)).toContain("true /music");
        const { SettingsStore } = await import("#settings/settingsStore");
        expect(SettingsStore.getInstance().getExtensionSettings("settler")).toEqual({ folder: "/music" });

        // Another write of the music settings, with the extension unknown, keeps its section.
        const { saveMusicSettings, getMusicSettings } = await import("#flows/musicDownloadFlow/settings");
        saveMusicSettings(getMusicSettings() as unknown as Record<string, unknown>);
        SettingsStore.getInstance().writeAppSettings(SettingsStore.getInstance().getAppSettings());
        expect(SettingsStore.getInstance().getExtensionSettings("settler")).toEqual({ folder: "/music" });
    });

    test("secrets are its own and never in the environment of the programs it starts", async () => {
        const folder = writeExtension("secretive", ``);
        fs.writeFileSync(
            path.join(folder, "index.js"),
            `export default async function activate(goblin) {
                goblin.secrets.set("token", "s3cr3t");
                const r = await goblin.spawn(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"]);
                goblin.log.info(String(goblin.secrets.get("token")) + "|" + r.stdout.includes("s3cr3t") + "|" + r.code);
            }\n`
        );
        await trust("secretive");
        await load();
        expect(store.get("secretive")?.log.map((l) => l.message)).toContain("s3cr3t|false|0");
        expect(process.env.GOBLIN_EXT_SECRETIVE__TOKEN).toBeUndefined();
    });

    test("a provider must extend the class goblin gave; its key is prefixed, and shows why when the extension is not loaded", async () => {
        writeExtension(
            "plat",
            `class Fake extends goblin.MetadataService {
                static display = { label: "Fake", acronym: "FAKE", color: "#123456", colorSubtle: "#000", colorBright: "#fff" };
                async getTrackMetadata() { throw new Error("no"); }
                async searchTrack() { return []; }
             }
             goblin.log.info(goblin.providers.metadata.register("fake", Fake));
             try { goblin.providers.metadata.register("copy", class { }); } catch (e) { goblin.log.info("refused: " + e.message); }`
        );
        await trust("plat");
        await load();
        const lines = store.get("plat")!.log.map((l) => l.message);
        expect(lines).toContain("plat.fake");
        expect(lines.some((l) => l.startsWith("refused:") && l.includes("must extend"))).toBe(true);
        const { metadataServiceRegistry } = await import("#flows/musicDownloadFlow/registries");
        expect(metadataServiceRegistry.getConstructor("plat.fake")).toBeDefined();
        const { providerDisplayRegistry } = await import("#base/providerDisplay");
        expect(providerDisplayRegistry.get("plat.fake").label).toBe("Fake");
        // A key of an extension that is not loaded (here: one that never was) says so.
        expect(providerDisplayRegistry.get("gone-ext.thing").label).toBe('thing (extension "gone-ext" is not loaded)');
        metadataServiceRegistry.unregister("plat.fake");
    });

    test("a Claude tool is checked like the app's own and named after the extension", async () => {
        writeExtension(
            "tooly",
            `goblin.log.info(goblin.agent.defineTool({ name: "count_tracks", summary: "Counts tracks.", kind: "read", locks: "none",
                input: { type: "object", properties: {} }, run: () => ({ count: goblin.tasks.list().length }) }));
             try { goblin.agent.defineTool({ name: "bad", summary: "", kind: "read", locks: "none", input: { type: "object" }, run() {} }); }
             catch (e) { goblin.log.info("refused"); }`
        );
        await trust("tooly");
        await load();
        const { agentToolRegistry } = await import("#base/agent/agentToolRegistry");
        expect(store.get("tooly")?.log.map((l) => l.message)).toEqual(
            expect.arrayContaining(["tooly__count_tracks", "refused"])
        );
        const tool = agentToolRegistry.get("tooly__count_tracks");
        expect(tool?.summary).toContain('extension "tooly"');
        expect(tool?.undoable).toBe(false);
        agentToolRegistry.unregister("tooly__count_tracks");
    });
});

describe("events", () => {
    test("handlers run after the fact, in order per track, and a failing or slow one never reaches the emitter", async () => {
        const { AppEventBus } = await import("#base/appEvents");
        const bus = new AppEventBus<{ ping: { n: number } }>({ abortGraceMs: 20 });
        const errors: string[] = [];
        bus.setErrorReporter(({ owner, error, timedOut }) =>
            errors.push(`${owner}:${timedOut ? "timeout" : String(error)}`)
        );
        const seen: number[] = [];
        bus.on(
            "ping",
            async ({ n }) => {
                await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1));
                seen.push(n);
            },
            { owner: "a" }
        );
        bus.on(
            "ping",
            () => {
                throw new Error("bad");
            },
            { owner: "b" }
        );
        bus.on("ping", () => new Promise(() => {}), { owner: "c", timeoutMs: 20 });
        let built = 0;
        expect(() => bus.emit("ping", () => ({ n: 1 + built++ }), "track-1")).not.toThrow();
        bus.emit("ping", { n: 2 }, "track-1");
        expect(seen).toEqual([]);
        await bus.drain();
        expect(seen).toEqual([1, 2]);
        expect(built).toBe(1);
        expect(errors).toEqual(expect.arrayContaining(["b:Error: bad", "c:timeout"]));
    });

    test("nobody listening: the payload is never built", async () => {
        const { AppEventBus } = await import("#base/appEvents");
        const bus = new AppEventBus<{ ping: number }>();
        let built = false;
        bus.emit("ping", () => {
            built = true;
            return 1;
        });
        await bus.drain();
        expect(built).toBe(false);
    });

    test("a handler that ran out of time is waited for a moment, so the next one does not run beside it", async () => {
        const { AppEventBus } = await import("#base/appEvents");
        const bus = new AppEventBus<{ ping: number }>({ abortGraceMs: 400 });
        bus.setErrorReporter(() => {});
        const log: string[] = [];
        bus.on(
            "ping",
            async (n) => {
                log.push(`start ${n}`);
                await new Promise((resolve) => setTimeout(resolve, n === 1 ? 80 : 1)); // ignores its signal
                log.push(`end ${n}`);
            },
            { owner: "a", timeoutMs: 20 }
        );
        bus.emit("ping", 1, "track");
        bus.emit("ping", 2, "track");
        await bus.drain();
        expect(log).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    });

    test("collection.done is announced for what finishes in the list, never for albums already done when they appear", async () => {
        const { musicEvents, watchCollectionsDone } = await import("#flows/musicDownloadFlow/appEvents");
        const { createTasksFromSnapshots } = await import("#flows/musicDownloadFlow/taskFactory");
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        const o = TaskOrchestrator.getInstance();
        o.setTasks([]);
        watchCollectionsDone(); // an extension's activate(), before any session is loaded

        const saved = { path: "/m/a.flac", savedAt: "2026-01-01T00:00:00.000Z", provider: "ytdlp", track: {} };
        const album = (id: string, doneTracks: boolean[]) => [
            {
                id,
                initialInput: `https://plat.test/album/${id}`,
                status: {},
                prompt: null,
                attributes: {
                    kind: "collection",
                    collectionKind: "album",
                    state: "finished",
                    userInput: { type: "url", url: `https://plat.test/album/${id}` },
                    childTaskIds: doneTracks.map((_, i) => `${id}-${i}`),
                },
            },
            ...doneTracks.map((isDone, i) =>
                snapshot(`${id}-${i}`, { parentTaskId: id, ...(isDone ? { savedFile: saved } : { state: "pending" }) })
            ),
        ];
        const heard: string[] = [];
        musicEvents.on(
            "collection.done",
            ({ collection, saved: n, total }) => void heard.push(`${collection.id} ${n}/${total}`)
        );

        // A session opened with a finished album: not news.
        o.setTasks(createTasksFromSnapshots(album("old", [true, true]) as never));
        // …and a track of it changing afterwards is not either.
        o.getTasks()
            .at(-1)!
            .getStatus()
            .set({ type: 1 as never, message: "x" });
        await musicEvents.drain();
        expect(heard).toEqual([]);

        // One that is half done, and finishes while it is in the list.
        const half = createTasksFromSnapshots(album("half", [true, false]) as never);
        o.setTasks(half);
        await musicEvents.drain();
        expect(heard).toEqual([]);
        half.find((t) => t.getId() === "half-1")!.updateAttributes({ savedFile: saved, state: "finished" } as never);
        await musicEvents.drain();
        expect(heard).toEqual(["half 2/2"]);
        o.setTasks([]);
    });

    test("a view never freezes the arrays of the task it describes", async () => {
        const { createTasksFromSnapshots } = await import("#flows/musicDownloadFlow/taskFactory");
        const { taskView } = await import("#flows/musicDownloadFlow/publicViews");
        const [task] = createTasksFromSnapshots([snapshot("task:gen", { metadataOverride: { genres: ["rock"] } })]);
        const view = taskView(task);
        expect(view?.kind === "track" && view.genres).toEqual(["rock"]);
        const own = (task.getAttributes() as { metadataOverride: { genres: string[] } }).metadataOverride.genres;
        expect(Object.isFrozen(own)).toBe(false);
        expect(() => own.push("pop")).not.toThrow();
    });

    test("an extension hears tasks.added with the ids, and track views are frozen copies", async () => {
        writeExtension(
            "listener",
            `goblin.on("tasks.added", ({ ids }) => {
                const view = goblin.tasks.get(ids[0]);
                goblin.log.info(ids.length + " " + Object.isFrozen(view) + " " + view.kind);
             });`
        );
        await trust("listener");
        await load();
        const { createTasksFromSnapshots, importTasks } = await import("#flows/musicDownloadFlow/taskFactory");
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        TaskOrchestrator.getInstance().setTasks([]);
        importTasks(createTasksFromSnapshots([snapshot("task:ev1")]));
        const { musicEvents } = await import("#flows/musicDownloadFlow/appEvents");
        await musicEvents.drain();
        expect(store.get("listener")?.log.map((l) => l.message)).toContain("1 true track");
        TaskOrchestrator.getInstance().setTasks([]);
    });
});

function snapshot(id: string, extra: Record<string, unknown> = {}) {
    return {
        id,
        initialInput: "https://plat.test/track/1",
        status: {},
        prompt: null,
        attributes: {
            kind: "track",
            state: "finished",
            userInput: { type: "url", url: "https://plat.test/track/1" },
            recognizedServiceKey: "gone-ext.plat",
            metadataGroups: [
                {
                    platform: "gone-ext.plat",
                    serviceKey: "gone-ext.plat",
                    rank: 0,
                    results: [
                        {
                            metadata: {
                                id: "1",
                                trackName: "Song",
                                artists: [{ type: "artist", name: "Artist" }],
                                url: "https://plat.test/track/1",
                                platform: "gone-ext.plat",
                                apiProvider: "gone-ext.plat",
                                fetchedAt: new Date().toISOString(),
                                type: "track",
                            },
                            isPrimaryInput: true,
                            isFavorited: true,
                            isRejected: false,
                            rank: 0,
                            discoverySources: [],
                        },
                    ],
                },
            ],
            metadataOverride: { year: 2001 },
            userSources: [{ url: "https://plat.test/track/2", uri: "GONE-EXT.PLAT::TRACK::2", addedAt: "2026-01-01" }],
            downloadSources: [],
            ...extra,
        },
    } as never;
}

describe("tasks", () => {
    test("a session made with a provider of a missing extension loads whole, and its data survives a restart", async () => {
        const { createTasksFromSnapshots } = await import("#flows/musicDownloadFlow/taskFactory");
        const { taskView } = await import("#flows/musicDownloadFlow/publicViews");
        const [task] = createTasksFromSnapshots([snapshot("task:gone1")]);
        const view = taskView(task);
        expect(view).toMatchObject({ kind: "track", title: "Song", artists: ["Artist"], year: 2001 });
        expect(view?.kind === "track" && view.sources[0].platform).toBe("gone-ext.plat");
        const track = task as import("#flows/musicDownloadFlow/utils/downloadTask").DownloadTask;
        await track.restart().catch(() => undefined);
        expect(track.getAttributes()?.metadataOverride).toEqual({ year: 2001 });
        expect(track.getAttributes()?.userSources?.[0]?.url).toBe("https://plat.test/track/2");
    });

    test("a write to a busy track is refused; a valid one goes through the named method and keeps user data", async () => {
        const { createTasksFromSnapshots } = await import("#flows/musicDownloadFlow/taskFactory");
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        const [task] = createTasksFromSnapshots([snapshot("task:w1")]);
        TaskOrchestrator.getInstance().setTasks([task]);
        const { createTasksApi, ExtensionWriteError } = await import("#extensions/api/tasksApi");
        const api = createTasksApi("Test");

        const after = await api.edit("task:w1").patchMetadata({ trackName: "New title", artists: ["A", "B"] });
        expect(after.title).toBe("New title");
        expect(after.artists).toEqual(["A", "B"]);
        expect(after.overrides).toMatchObject({ year: 2001 });
        await expect(api.edit("task:w1").patchMetadata({ isrc: "not an isrc" })).rejects.toBeInstanceOf(
            ExtensionWriteError
        );

        const busy = vi.spyOn(task, "isBusy").mockReturnValue(true);
        await expect(api.edit("task:w1").patchMetadata({ trackName: "x" })).rejects.toMatchObject({ code: "busy" });
        busy.mockRestore();

        const { taskLocks } = await import("#base/task/taskLock");
        const got = taskLocks.acquire(["task:w1"], "agent");
        expect(got.ok).toBe(true);
        await expect(api.edit("task:w1").patchMetadata({ trackName: "x" })).rejects.toMatchObject({ code: "locked" });
        if (got.ok) got.lease.release();

        expect(api.list({ query: "new title" }).map((v) => v.id)).toEqual(["task:w1"]);
        TaskOrchestrator.getInstance().setTasks([]);
    });

    test("remove asks first and keeps everything when the answer is no; a busy task is never removed", async () => {
        const { createTasksFromSnapshots } = await import("#flows/musicDownloadFlow/taskFactory");
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        const tasks = createTasksFromSnapshots([snapshot("task:r1"), snapshot("task:r2")]);
        const o = TaskOrchestrator.getInstance();
        o.setTasks(tasks);
        const { createTasksApi } = await import("#extensions/api/tasksApi");
        const api = createTasksApi("Test");
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        let asked = "";
        dialogBridge.setConfirmOpener((dialog, resolve) => {
            asked = dialog.message;
            resolve(0);
        });
        try {
            expect(await api.remove(["task:r1"])).toEqual([]);
            expect(asked).toContain('"Test"');
            expect(o.getTasks()).toHaveLength(2);
            const busy = vi.spyOn(tasks[1], "isBusy").mockReturnValue(true);
            expect(await api.remove(["task:r1", "task:r2"], { confirm: false })).toEqual(["task:r1"]);
            expect(o.getTasks().map((t) => t.getId())).toEqual(["task:r2"]);
            busy.mockRestore();
        } finally {
            dialogBridge.setConfirmOpener(null);
            o.setTasks([]);
        }
    });
});

describe("the sample extensions", () => {
    test("both load with --extension and add what they say", async () => {
        const examples = path.resolve(__dirname, "../../examples/extensions");
        await load({ devPaths: [path.join(examples, "library-dedupe"), path.join(examples, "after-save-command")] });
        expect(store.get("library-dedupe")?.state).toBe("loaded");
        expect(store.get("after-save-command")?.state).toBe("loaded");
        const { actionsMenuRegistry } = await import("#base/actionsMenu");
        expect(actionsMenuRegistry.list().map((i) => i.id)).toContain("library-dedupe.removeOwned");
        const { agentToolRegistry } = await import("#base/agent/agentToolRegistry");
        expect(agentToolRegistry.has("library_dedupe__find_owned")).toBe(true);
        expect(store.get("after-save-command")?.contributions.events).toBe(1);
        agentToolRegistry.unregister("library_dedupe__find_owned");
    });
});

describe("the ext command", () => {
    test("new → add → list → remove", async () => {
        const { runExtCommand } = await import("#extensions/extCli");
        const lines: string[] = [];
        const out = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(`ERR ${l}`) };
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-cli-"));
        const source = path.join(work, "hello-world");
        expect(await runExtCommand(["new", "hello-world", source], out, root)).toBe(0);
        expect(fs.existsSync(path.join(source, "extension.json"))).toBe(true);
        expect(await runExtCommand(["add", source], out, root)).toBe(0);
        expect(fs.existsSync(path.join(root, "hello-world", "index.js"))).toBe(true);
        expect(await runExtCommand(["add", source], out, root)).toBe(1);
        lines.length = 0;
        expect(await runExtCommand(["list"], out, root)).toBe(0);
        expect(lines.join("\n")).toContain("hello-world 0.1.0  not allowed yet");
        expect(await runExtCommand(["remove", "hello-world", "--yes"], out, root)).toBe(0);
        expect(fs.existsSync(path.join(root, "hello-world"))).toBe(false);
    });

    test("-y answers the question of remove, and a source that lives under node_modules is still copied", async () => {
        const { runExtCommand } = await import("#extensions/extCli");
        const out = { log: () => {}, error: () => {} };
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-ext-cli-"));
        const source = path.join(work, "node_modules", "some-pkg", "my-ext");
        expect(await runExtCommand(["new", "my-ext", source], out, root)).toBe(0);
        expect(await runExtCommand(["add", source], out, root)).toBe(0);
        expect(fs.existsSync(path.join(root, "my-ext", "index.js"))).toBe(true);
        expect(await runExtCommand(["remove", "my-ext", "-y"], out, root)).toBe(0);
        expect(fs.existsSync(path.join(root, "my-ext"))).toBe(false);
    });

    test("the scaffolded extension loads and runs", async () => {
        const { scaffoldFiles } = await import("#extensions/extCli");
        const folder = path.join(root, "scaffolded");
        fs.mkdirSync(folder);
        for (const [file, content] of Object.entries(scaffoldFiles("scaffolded")))
            fs.writeFileSync(path.join(folder, file), content);
        await trust("scaffolded");
        await load();
        expect(store.get("scaffolded")?.state).toBe("loaded");
        const { actionsMenuRegistry } = await import("#base/actionsMenu");
        expect(actionsMenuRegistry.list().map((i) => i.id)).toContain("scaffolded.hello");
    });
});

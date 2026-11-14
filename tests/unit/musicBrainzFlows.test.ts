// Must stay the first import: it points the app's data folder at a temp dir before any app code loads.
import {
    ALBUM_URL,
    ARTIST_URL,
    BARCODE,
    MB_RELEASE,
    albumWithTracks,
    endWorld,
    loadWorld,
    makeTask,
    removeDataDir,
    resetWorld,
    world,
} from "./helpers/musicBrainzWorld";
import * as http from "http";
import { type AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { ConfirmDialog, ListAnswer, ListDialog } from "#base/bridges/dialogBridge";

// The user's browser: never really opened here. Each test sets what "opening a URL" does.
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));

/**
 * What the user can do about a verdict — review candidates, grant consent, hand a missing release over to MusicBrainz —
 * driven through scripted dialogs and a fake browser. These are the flows that end in a public edit, so they are
 * checked as a user would meet them: what is shown, what is asked, and what is (not) opened.
 */

let w: Awaited<ReturnType<typeof loadWorld>>;
let actions: typeof import("#flows/musicDownloadFlow/musicbrainz/identityActions");
let orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
let openMock: ReturnType<typeof vi.fn>;

// Every dialog the flows opened, and the answers the "user" gives, in order. An unscripted dialog is dismissed.
let shown: { confirm: ConfirmDialog[]; list: ListDialog[] };
let script: { confirm: (number | null)[]; list: ListAnswer[] };

/** A stand-in for MusicBrainz Picard's browser integration: records what it is asked, answers with `status`. */
type FakePicard = {
    port: number;
    requests: string[];
    received: (n: number) => Promise<void>;
    close: () => Promise<void>;
};
const fakePicards: FakePicard[] = [];

async function startFakePicard(status = 200): Promise<FakePicard> {
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url ?? "");
        res.writeHead(status, status === 302 ? { Location: "/" } : {});
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { picardPort: String(port) } });
    const fake: FakePicard = {
        port,
        requests,
        received: async (n) => {
            for (let i = 0; i < 100 && requests.length < n; i++) await new Promise((r) => setTimeout(r, 10));
        },
        close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
    };
    fakePicards.push(fake);
    return fake;
}

const DELUXE = { ...MB_RELEASE, id: "rel-deluxe", media: [{ "track-count": 14 }], score: 100 };

beforeAll(async () => {
    w = await loadWorld();
    actions = await import("#flows/musicDownloadFlow/musicbrainz/identityActions");
    orchestrator = (await import("#base/task/orchestrator")).TaskOrchestrator.getInstance();
});
afterAll(() => removeDataDir());

beforeEach(async () => {
    await resetWorld();
    const { dialogBridge } = await import("#base/bridges/dialogBridge");
    shown = { confirm: [], list: [] };
    script = { confirm: [], list: [] };
    dialogBridge.setConfirmOpener((dialog, resolve) => {
        shown.confirm.push(dialog);
        resolve(script.confirm.shift() ?? null);
    });
    // Like the real modal: a dialog with a `body` opens at once, and shows the body when it arrives (a body that is
    // empty or failed closes it, answered null). What the tests inspect is what ends up on screen.
    dialogBridge.setListOpener(async (dialog, resolve) => {
        let onScreen = dialog;
        if (dialog.body) {
            const body = await dialog.body.catch(() => null);
            if (!body) return resolve(null);
            onScreen = { ...dialog, ...body };
        }
        shown.list.push(onScreen);
        resolve(script.list.shift() ?? null);
    });
    openMock = (await import("open")).default as unknown as ReturnType<typeof vi.fn>;
    openMock.mockReset();
    openMock.mockResolvedValue(undefined);
    w.SettingsStore.getInstance().patchMusicSettings({
        musicBrainz: { contribute: false, contributeAsked: false, contributeVia: "harmony", picardPort: "8000" },
    });
});

afterEach(async () => {
    const { dialogBridge } = await import("#base/bridges/dialogBridge");
    dialogBridge.setConfirmOpener(null);
    dialogBridge.setListOpener(null);
    orchestrator.setTasks([]);
    await Promise.all(fakePicards.splice(0).map((p) => p.close()));
    await endWorld();
});

const identityOf = (t: DownloadTask) => t.getAttributes()?.musicBrainzIdentity;
const allowContributing = (via = "harmony") =>
    w.SettingsStore.getInstance().patchMusicSettings({
        musicBrainz: { contribute: true, contributeAsked: true, contributeVia: via },
    });
const settings = async () => (await import("#flows/musicDownloadFlow/settings")).getMusicSettings().musicBrainz;

/** A track of an album MusicBrainz does not have, with the album's full track list available. */
async function addableTask(): Promise<DownloadTask> {
    world.mbKnowsTheAlbum = false;
    world.albumDetails = albumWithTracks();
    const task = await makeTask("t1");
    orchestrator.setTasks([task]);
    await task.checkMusicBrainz();
    expect(identityOf(task)?.verdict).toBe("notFound");
    return task;
}

// ── Review ───────────────────────────────────────────────────────────────────────────────

describe("reviewing a match", () => {
    async function twoTracksNeedingReview() {
        world.mbKnowsTheAlbum = false;
        world.barcodeHits = [DELUXE]; // same barcode, 14 tracks vs 9: a candidate, never an automatic match
        const a = await makeTask("t1");
        const b = await makeTask("t2");
        orchestrator.setTasks([a, b]);
        await a.checkMusicBrainz();
        await b.checkMusicBrainz();
        expect(identityOf(a)?.verdict).toBe("needsReview");
        return { a, b };
    }

    test("the chosen release is applied to this track AND the album's other tracks", async () => {
        const { a, b } = await twoTracksNeedingReview();

        script.list = [{ index: 0 }];
        await actions.reviewMusicBrainzRelease(a);

        expect(shown.list[0].items).toHaveLength(1);
        expect(shown.list[0].items[0].detail?.join(" ")).toContain("Barcode");
        expect(shown.list[0].noneLabel).toContain("None of these");
        for (const t of [a, b]) {
            expect(identityOf(t)).toMatchObject({ verdict: "matched", decidedBy: "user" });
            expect(identityOf(t)?.release?.id).toBe("rel-deluxe");
        }
    });

    test("'none of these' turns the candidates down for the whole album — and they stay turned down", async () => {
        const { a, b } = await twoTracksNeedingReview();

        script.list = [{ none: true }];
        await actions.reviewMusicBrainzRelease(a);
        expect(identityOf(a)).toMatchObject({ verdict: "notFound", decidedBy: "user" });
        expect(identityOf(b)).toMatchObject({ verdict: "notFound", decidedBy: "user" });

        await a.checkMusicBrainz({ force: true }); // a later re-check must not resurrect them
        expect(identityOf(a)?.verdict).toBe("notFound");
    });

    test("dismissing the review changes nothing", async () => {
        const { a } = await twoTracksNeedingReview();
        script.list = [null];
        await actions.reviewMusicBrainzRelease(a);
        expect(identityOf(a)?.verdict).toBe("needsReview");
    });

    test("there is nothing to review on a track that is not waiting for a review", async () => {
        const task = await makeTask("t1");
        await task.checkMusicBrainz();
        await actions.reviewMusicBrainzRelease(task);
        expect(shown.list).toEqual([]);
    });
});

// ── Alternatives to a matched release ────────────────────────────────────────────────────

describe("the other releases of a matched track", () => {
    // What the real API returns for the album "Night Drive": a CD that carries the barcode the streaming service
    // reports, and the digital edition of the same release group, which has no barcode in MusicBrainz.
    const CD = { ...MB_RELEASE, id: "rel-cd", media: [{ format: "CD", "track-count": 9 }], score: 100 };
    const DIGITAL = {
        ...MB_RELEASE,
        id: "rel-digital",
        barcode: undefined,
        media: [{ format: "Digital Media", "track-count": 9 }],
    };
    const ids = async (task: DownloadTask) =>
        (await import("#flows/musicDownloadFlow/musicbrainz/columnActions"))
            .musicBrainzActionItems(task)
            .map((i) => i.id);

    async function matchedThroughTheCd(id = "t1") {
        world.mbKnowsTheAlbum = false;
        world.barcodeHits = [CD];
        world.groupReleases = [CD, DIGITAL];
        const task = await makeTask(id);
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        return task;
    }

    test("the barcode points at the CD: the digital edition of its release group is the match", async () => {
        const task = await matchedThroughTheCd();
        expect(identityOf(task)).toMatchObject({ verdict: "matched", decidedBy: "auto", releaseGroupId: "rg-1" });
        expect(identityOf(task)?.release?.id).toBe("rel-digital");
        expect(identityOf(task)?.alternatives?.map((a) => a.release.id)).toEqual(["rel-cd"]);
    });

    test("the alternatives are one button away, and picking one is the user's word for the whole album", async () => {
        const task = await matchedThroughTheCd();
        const other = await makeTask("t2");
        orchestrator.setTasks([task, other]);
        await other.checkMusicBrainz();
        expect(await ids(task)).toContain("alternatives");

        script.list = [{ index: 1 }]; // 0 is the one matched now
        await actions.chooseMusicBrainzAlternative(task);

        expect(shown.list[0].items.map((i) => i.label)).toEqual([
            expect.stringContaining("(matched now)"),
            expect.stringContaining("Night Drive"),
        ]);
        expect(shown.list[0].noneLabel).toBeUndefined();
        for (const t of [task, other]) {
            expect(identityOf(t)).toMatchObject({ verdict: "matched", decidedBy: "user" });
            expect(identityOf(t)?.release?.id).toBe("rel-cd");
        }
        // And the digital edition is now an alternative to it.
        expect(identityOf(task)?.alternatives?.map((a) => a.release.id)).toEqual(["rel-digital"]);
    });

    test("the dialog opens at once with a loader; the releases' links are loaded behind it", async () => {
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        const task = await matchedThroughTheCd();
        // A release's links are looked up by id: hold that answer back, as a slow network would.
        const api = (w.MusicBrainzClient as unknown as { api: { lookup: (...a: unknown[]) => Promise<unknown> } }).api;
        const lookup = api.lookup;
        let letGo!: () => void;
        const gate = new Promise<void>((resolve) => (letGo = resolve));
        api.lookup = async (entity: unknown, ...rest: unknown[]) => {
            if (entity === "release") await gate;
            return lookup(entity, ...rest);
        };
        let opened: ListDialog | undefined;
        let answer!: (a: ListAnswer) => void;
        dialogBridge.setListOpener((dialog, resolve) => {
            opened = dialog;
            answer = resolve;
        });

        const flow = actions.chooseMusicBrainzAlternative(task);
        await vi.waitFor(() => expect(opened).toBeDefined());

        // Open while nothing has been loaded yet: no items, a loader's text, the content still on its way.
        expect(opened!.items).toEqual([]);
        expect(opened!.loadingLabel).toContain("Loading");
        expect(opened!.body).toBeInstanceOf(Promise);

        letGo();
        const body = await opened!.body!;
        expect(body!.items).toHaveLength(2);
        answer({ index: 0 });
        await flow;
        expect(shown.list).toEqual([]);
    });

    test("a body that comes back empty or fails closes the dialog, answered null", async () => {
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        dialogBridge.setListOpener(async (dialog, resolve) => {
            const body = await dialog.body!.catch(() => null);
            resolve(body ? { index: 0 } : null);
        });
        const failing = Promise.reject(new Error("offline"));
        expect(await dialogBridge.choose({ title: "x", items: [], body: failing })).toBeNull();
        expect(await dialogBridge.choose({ title: "x", items: [], body: Promise.resolve(null) })).toBeNull();
        expect(await dialogBridge.choose({ title: "x", items: [], body: Promise.resolve({ items: [] }) })).toEqual({
            index: 0,
        });
    });

    test("keeping the one matched now, or dismissing the list, changes nothing", async () => {
        const task = await matchedThroughTheCd();
        script.list = [{ index: 0 }];
        await actions.chooseMusicBrainzAlternative(task);
        script.list = [null];
        await actions.chooseMusicBrainzAlternative(task);
        expect(identityOf(task)).toMatchObject({ decidedBy: "auto" });
        expect(identityOf(task)?.release?.id).toBe("rel-digital");
    });

    test("no alternatives, no button; the release group button needs only the group", async () => {
        world.groupReleases = [];
        const task = await makeTask("t1");
        await task.checkMusicBrainz();
        expect(identityOf(task)?.alternatives).toEqual([]);
        expect(await ids(task)).not.toContain("alternatives");
        expect(await ids(task)).toContain("group");
        await actions.chooseMusicBrainzAlternative(task);
        expect(shown.list).toEqual([]);
    });

    test("the release group button opens the group in the browser", async () => {
        const { musicBrainzActionItems } = await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
        const task = await matchedThroughTheCd();
        const group = musicBrainzActionItems(task).find((i) => i.id === "group")!;
        expect(group.label).toBe("Open MusicBrainz release group");
        group.run();
        await vi.waitFor(() => expect(openMock).toHaveBeenCalledWith("https://musicbrainz.org/release-group/rg-1"));
    });
});

// ── Permission ───────────────────────────────────────────────────────────────────────────

describe("permission to add releases", () => {
    test("the first 'Add' asks; dismissing the question is not an answer", async () => {
        const task = await addableTask();
        script.confirm = [null];
        await actions.addToMusicBrainz(task);
        expect(shown.confirm).toHaveLength(1);
        expect(shown.confirm[0].title).toContain("Add missing releases");
        expect(openMock).not.toHaveBeenCalled();
        expect(await settings()).toMatchObject({ contribute: false, contributeAsked: false });
    });

    test("'Not now' is remembered: nothing opens, and the next 'Add' only says it is off", async () => {
        const task = await addableTask();
        script.confirm = [0];
        await actions.addToMusicBrainz(task);
        expect(await settings()).toMatchObject({ contribute: false, contributeAsked: true });

        script.confirm = [0];
        await actions.addToMusicBrainz(task);
        expect(shown.confirm[1].title).toContain("turned off");
        expect(openMock).not.toHaveBeenCalled();
    });

    test("with nobody to ask (headless) it never counts as a yes", async () => {
        const task = await addableTask();
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        dialogBridge.setConfirmOpener(null);
        await actions.addToMusicBrainz(task);
        expect(openMock).not.toHaveBeenCalled();
        expect(await settings()).toMatchObject({ contribute: false, contributeAsked: false });
    });

    test("a release that is not ruled out cannot be added", async () => {
        const task = await makeTask("t1"); // MusicBrainz knows the album: matched
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        expect(identityOf(task)?.verdict).toBe("matched");
        script.confirm = [0];
        await actions.addToMusicBrainz(task);
        expect(shown.confirm[0].title).toContain("Can't add");
        expect(openMock).not.toHaveBeenCalled();
    });
});

// ── The duplicate guard ──────────────────────────────────────────────────────────────────

describe("the last look before adding", () => {
    test("another track of the album already on a release stops the add: nothing is opened", async () => {
        const task = await addableTask();
        allowContributing();
        world.mbIsrcs.add("ISRC2"); // track 2 is already in MusicBrainz, on a release with the album's title

        script.confirm = [0];
        await actions.addToMusicBrainz(task);

        expect(shown.confirm.map((d) => d.title)).toEqual(["Not adding: this may already exist"]);
        expect(shown.confirm[0].message).toContain("Day Drive");
        expect(openMock).not.toHaveBeenCalled();
    });

    test("a check that could not be completed stops it too — never 'probably fine'", async () => {
        const task = await addableTask();
        allowContributing();
        const { MusicBrainzApiError } = await import("musicbrainz-api");
        const real = (w.MusicBrainzClient as unknown as { api: { lookup: (...a: unknown[]) => Promise<unknown> } }).api;
        const lookup = real.lookup;
        real.lookup = async (entity: unknown, id: unknown, ...rest: unknown[]) => {
            if (entity === "isrc" && id === "ISRC2") {
                throw new MusicBrainzApiError("busy", { status: 503, statusText: "Service Unavailable" });
            }
            return lookup(entity, id, ...rest);
        };
        script.confirm = [0];
        await actions.addToMusicBrainz(task);
        expect(shown.confirm.map((d) => d.title)).toEqual(["Couldn't check MusicBrainz"]);
        expect(openMock).not.toHaveBeenCalled();
    });
});

// ── Hand-off ─────────────────────────────────────────────────────────────────────────────

describe("handing the release over to MusicBrainz", () => {
    test("via Harmony: shows what it knows, and only on 'Open in browser' opens Harmony for the album", async () => {
        const task = await addableTask();
        allowContributing("harmony");

        script.confirm = [1, 0]; // "Open in browser", then OK on the "continue in your browser" notice
        await actions.addToMusicBrainz(task);

        const preview = shown.confirm[0];
        expect(preview.title).toBe("Add to MusicBrainz");
        expect(preview.choices[0].label).toBe("Cancel"); // the safe button is the default
        expect(preview.message).toContain("Night Drive");
        expect(preview.message).toContain("Nothing is submitted by Goblin Malin");

        expect(openMock).toHaveBeenCalledTimes(1);
        const opened = new URL(openMock.mock.calls[0][0] as string);
        expect(opened.origin).toBe("https://harmony.pulsewidth.org.uk");
        expect(opened.searchParams.get("url")).toBe(ALBUM_URL);
        expect(opened.searchParams.get("gtin")).toBe(BARCODE);
        expect(identityOf(task)?.handedOffAt).toBeTruthy();
    });

    test("cancelling the preview opens nothing and records no hand-off", async () => {
        const task = await addableTask();
        allowContributing();
        script.confirm = [0]; // Cancel
        await actions.addToMusicBrainz(task);
        expect(openMock).not.toHaveBeenCalled();
        expect(identityOf(task)?.handedOffAt).toBeUndefined();
    });

    test("an album the service cannot describe track by track cannot be prepared", async () => {
        const task = await addableTask();
        allowContributing();
        world.albumDetails = null;
        script.confirm = [0];
        await actions.addToMusicBrainz(task);
        expect(shown.confirm[0].title).toBe("Can't read the album");
        expect(openMock).not.toHaveBeenCalled();
    });

    test("direct: serves a pre-filled form, and the release id that comes back is verified and applied", async () => {
        const task = await addableTask();
        allowContributing("direct");
        const NEW_RELEASE = "4587fe99-db0e-4553-a56a-164dd38ab380";
        let form = "";

        // The release the user entered: this album's barcode and its two tracks.
        const api = (w.MusicBrainzClient as unknown as { api: { lookup: (...a: unknown[]) => Promise<unknown> } }).api;
        const lookup = api.lookup;
        api.lookup = async (entity: unknown, id: unknown, ...rest: unknown[]) =>
            entity === "release" && id === NEW_RELEASE
                ? { ...MB_RELEASE, id, media: [{ "track-count": 2 }] }
                : lookup(entity, id, ...rest);

        // The user's browser: loads the page the app opened, then MusicBrainz sends it back with the new release's id.
        openMock.mockImplementation(async (url: string) => {
            void (async () => {
                form = await (await fetch(url)).text();
                const redirect = form.match(/name="redirect_uri" value="([^"]+)"/)![1];
                await fetch(`${redirect}?release_mbid=${NEW_RELEASE}`);
            })();
        });

        script.confirm = [1];
        await actions.addToMusicBrainz(task);

        expect(form).toContain('name="name" value="Night Drive"');
        expect(form).toContain('name="status" value="official"');
        expect(form).toContain(`name="barcode" value="${BARCODE}"`);
        expect(form).toContain('name="urls.0.url" value="https://open.spotify.com/album/alb1"');
        expect(form).toContain('name="mediums.0.track.1.name" value="Day Drive"');
        expect(form).toContain('action="https://musicbrainz.org/release/add"');
        // The artist's streaming page is a MusicBrainz link, so the artist is sent by MBID — never by name alone.
        expect(form).toContain('name="artist_credit.names.0.mbid" value="art-1"');
        expect(form).not.toContain(ARTIST_URL);

        // The id MusicBrainz reported is only trusted once the release itself shows the evidence (here: the barcode).
        expect(identityOf(task)).toMatchObject({ verdict: "matched" });
        expect(identityOf(task)?.release?.id).toBe(NEW_RELEASE);
    });

    test("direct: a release id that does not match the album is NOT taken", async () => {
        const task = await addableTask();
        allowContributing("direct");
        const STRANGER = "11111111-2222-4333-8444-555555555555";
        // Whatever that id is in MusicBrainz, it has another barcode and no link to this album.
        const api = (w.MusicBrainzClient as unknown as { api: { lookup: (...a: unknown[]) => Promise<unknown> } }).api;
        const lookup = api.lookup;
        api.lookup = async (entity: unknown, id: unknown, ...rest: unknown[]) =>
            entity === "release" && id === STRANGER
                ? { ...MB_RELEASE, id, barcode: "9999999999999" }
                : lookup(entity, id, ...rest);

        openMock.mockImplementation(async (url: string) => {
            void (async () => {
                const form = await (await fetch(url)).text();
                const redirect = form.match(/name="redirect_uri" value="([^"]+)"/)![1];
                await fetch(`${redirect}?release_mbid=${STRANGER}`);
            })();
        });
        script.confirm = [1, 0]; // open, then OK on whatever follows
        await actions.addToMusicBrainz(task);
        expect(identityOf(task)?.verdict).not.toBe("matched");
    });
});

void ARTIST_URL;

// ── What the panel's buttons and the task list's actions share ───────────────────────────

describe("the MusicBrainz actions on offer", () => {
    const ids = async (task: DownloadTask) =>
        (await import("#flows/musicDownloadFlow/musicbrainz/columnActions"))
            .musicBrainzActionItems(task)
            .map((i) => i.id);

    test("matched: Picard, the release page, re-check", async () => {
        const task = await makeTask("t1");
        await task.checkMusicBrainz();
        expect(await ids(task)).toEqual(["picard", "open", "links", "group", "search", "recheck"]);
    });

    // The metadata panel can ask for an album row while it still shows the previous track (holding ↑ in a long list
    // threw "groups is not iterable": an album has no metadata groups).
    test("an album or playlist row offers none, and does not throw", async () => {
        const album = {
            getAttributes: () => ({ kind: "collection", collectionKind: "album", childTaskIds: [] }),
        } as unknown as DownloadTask;
        expect(await ids(album)).toEqual([]);
    });

    test("the search button opens MusicBrainz's tag lookup prefilled with the track", async () => {
        const { tagLookupUrl } = await import("#flows/musicDownloadFlow/musicbrainz/tagLookup");
        expect(
            tagLookupUrl({
                trackName: "don't you miss me",
                artists: [{ type: "artist", name: "Aki Oke" }],
                album: { id: "a", albumName: "don't you miss me", url: "u", uri: "u" },
                trackNumber: 1,
                duration: 213000,
            })
        ).toBe(
            "https://musicbrainz.org/taglookup/index?tag-lookup.artist=Aki+Oke&tag-lookup.release=don%27t+you+miss+me" +
                "&tag-lookup.tracknum=1&tag-lookup.track=don%27t+you+miss+me&tag-lookup.duration=213000&tag-lookup.filename="
        );
        expect(tagLookupUrl({ trackName: "x", artists: [] })).toBeUndefined();
    });

    test("Picard opens the matched RELEASE (to match files to it), from the verdict", async () => {
        const { musicBrainzActionItems } = await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
        const task = await makeTask("t1");
        await task.checkMusicBrainz();
        const fake = await startFakePicard();
        const picard = musicBrainzActionItems(task).find((i) => i.id === "picard")!;
        expect(picard.label).toBe("Open in MusicBrainz Picard");
        expect(picard.shortcut).toEqual({ key: "return" });
        picard.run();
        await fake.received(1);
        // Straight to Picard's local server: no browser involved.
        expect(fake.requests).toEqual(["/openalbum?id=rel-1"]);
        expect(openMock).not.toHaveBeenCalled();
    });

    test("with only a recording known, Picard opens the recording; with nothing known there is no Picard", async () => {
        const { picardUrlFor } = await import("#flows/musicDownloadFlow/musicbrainz/picard");
        expect(picardUrlFor({ recordingId: "rec-9" })).toBe("http://127.0.0.1:8000/opennat?id=rec-9");
        expect(picardUrlFor({ release: { id: "r" }, recordingId: "rec-9" })).toBe(
            "http://127.0.0.1:8000/openalbum?id=r"
        );
        expect(picardUrlFor({})).toBeUndefined();
    });

    test("a verdict that still needs review but knows the recording offers Picard after the review", async () => {
        const task = await makeTask("t1");
        const candidate = {
            release: { id: "rel-x", title: "Night Drive", artists: [] },
            evidence: ["barcode" as const],
        };
        task.updateAttributes({
            musicBrainzIdentity: {
                verdict: "needsReview",
                decidedBy: "auto",
                checkedAt: "2026-11-11T10:00:00.000Z",
                recordingId: "rec-1",
                artists: [],
                candidates: [candidate],
                checks: [],
                evidence: [],
            },
        });
        expect(await ids(task)).toEqual(["review", "picard", "search", "recheck"]);
    });

    test("needs review: review the match first", async () => {
        world.mbKnowsTheAlbum = false;
        world.barcodeHits = [DELUXE];
        const task = await makeTask("t1");
        await task.checkMusicBrainz();
        expect((await ids(task))[0]).toBe("review");
    });

    test("not found: add the release; unknown: only a re-check", async () => {
        const task = await addableTask();
        expect(await ids(task)).toEqual(["add", "search", "recheck"]);

        world.albumDetails = null;
        world.withAlbumDetails = false;
        const unknown = await makeTask("t2");
        await unknown.checkMusicBrainz();
        expect(await ids(unknown)).toEqual(["search", "recheck"]);
    });

    test("the task list's column and the panel's buttons are made from the same list", async () => {
        const { musicBrainzActionItems, musicBrainzColumnActions } =
            await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
        const task = await addableTask();
        const items = musicBrainzActionItems(task);
        const actions = musicBrainzColumnActions(task);
        expect(actions.map((a) => a.label)).toEqual(items.map((i) => i.label));
        expect(actions.map((a) => a.shortcuts[0])).toEqual(items.map((i) => i.shortcut));
        // Only the re-check works on a whole selection.
        expect(actions.filter((a) => a.multiSelectAllowed).map((a) => a.label)).toEqual(["Re-check on MusicBrainz"]);
    });

    test("every release in the review has a page to open", async () => {
        world.mbKnowsTheAlbum = false;
        world.barcodeHits = [DELUXE];
        const task = await makeTask("t1");
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        script.list = [null];
        await actions.reviewMusicBrainzRelease(task);
        expect(shown.list[0].items.map((i) => i.url)).toEqual(["https://musicbrainz.org/release/rel-deluxe"]);
        expect(shown.list[0].items[0].detail).toContain("https://musicbrainz.org/release/rel-deluxe");
    });
});

/** The real service minus its UI cell (vitest cannot resolve the cell's "#components/…" imports): same column actions. */
async function fakeMusicBrainzService() {
    const { DiscoveryMetadataService } = await import("#flows/musicDownloadFlow/discoveryMetadataService");
    const { musicBrainzColumnActions } = await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
    return class FakeMusicBrainz extends DiscoveryMetadataService {
        static readonly display = {
            label: "MusicBrainz",
            acronym: "MB",
            color: "#741b81",
            colorSubtle: "#6b1060",
            colorBright: "#ba47b5",
        };
        static readonly columnActions = musicBrainzColumnActions;
        constructor(task: DownloadTask, logger: never) {
            super("FakeMusicBrainz", task, logger);
        }
        async discoverFromUri() {
            return { tracks: [] };
        }
    };
}

describe("the task list's MusicBrainz column", () => {
    test("Picard is offered once, from the verdict (the discovery anchor no longer carries a Picard address)", async () => {
        const { discoveryServiceRegistry } = await import("#flows/musicDownloadFlow/registries");
        const MusicBrainzDiscoveryService = await fakeMusicBrainzService();
        const { buildContextualActionBar } = await import("#flows/musicDownloadFlow/contextualActions");
        discoveryServiceRegistry.register("musicBrainz", MusicBrainzDiscoveryService as never);
        try {
            const fake = await startFakePicard();
            const task = await makeTask("t1");
            await task.checkMusicBrainz(); // matched: the verdict knows the release
            task.updateAttributes({
                discoveryAnchors: {
                    musicBrainz: {
                        state: "found",
                        url: "https://musicbrainz.org/recording/rec-1",
                        id: "rec-1",
                    },
                },
            });
            const bar = buildContextualActionBar(task, {
                columns: [{ id: "discoveryService-musicBrainz", label: "MB" } as never],
                columnIndex: 0,
            });
            const labels = bar.rows[0].actions.map((a) => a.label);
            expect(labels.filter((l) => l === "Open in MusicBrainz Picard")).toHaveLength(1);
            // The verdict's one wins: it opens the release, not just the recording.
            bar.rows[0].actions.find((a) => a.label === "Open in MusicBrainz Picard")!.onClick();
            await fake.received(1);
            expect(fake.requests).toEqual(["/openalbum?id=rel-1"]);
            expect(openMock).not.toHaveBeenCalled();
        } finally {
            discoveryServiceRegistry.unregister("musicBrainz");
        }
    });

    test("with no verdict yet, the recording the discovery found is still opened in Picard (no other choice)", async () => {
        const { discoveryServiceRegistry } = await import("#flows/musicDownloadFlow/registries");
        const MusicBrainzDiscoveryService = await fakeMusicBrainzService();
        const { buildContextualActionBar } = await import("#flows/musicDownloadFlow/contextualActions");
        discoveryServiceRegistry.register("musicBrainz", MusicBrainzDiscoveryService as never);
        try {
            const task = await makeTask("t1");
            task.updateAttributes({
                discoveryAnchors: {
                    musicBrainz: {
                        state: "found",
                        url: "https://musicbrainz.org/recording/rec-1",
                        id: "rec-1",
                    },
                },
            });
            const fake = await startFakePicard();
            const bar = buildContextualActionBar(task, {
                columns: [{ id: "discoveryService-musicBrainz", label: "MB" } as never],
                columnIndex: 0,
            });
            const labels = bar.rows[0].actions.map((a) => a.label);
            expect(labels).toContain("Open in MusicBrainz Picard");
            // The recording's web page is still offered, on a key that is not Enter (Enter is Picard's).
            const web = bar.rows[0].actions.find((a) => a.label === "Open in MusicBrainz")!;
            expect(web.shortcuts).toEqual([{ input: "o" }]);
            bar.rows[0].actions.find((a) => a.label === "Open in MusicBrainz Picard")!.onClick();
            await fake.received(1);
            expect(fake.requests).toEqual(["/opennat?id=rec-1"]);
        } finally {
            discoveryServiceRegistry.unregister("musicBrainz");
        }
    });
});

// ── Picard: the release always comes first ───────────────────────────────────────────────

describe("what Picard is asked to open", () => {
    test("priority: confirmed release > strongest candidate release > recording > nothing", async () => {
        const { picardTargetFor } = await import("#flows/musicDownloadFlow/musicbrainz/picard");
        const candidates = [{ release: { id: "cand-1" } }, { release: { id: "cand-2" } }];

        // A release is known: never the recording, even though the recording is known too.
        expect(picardTargetFor({ release: { id: "rel" }, candidates, recordingId: "rec" })).toEqual({
            url: "http://127.0.0.1:8000/openalbum?id=rel",
            kind: "release",
        });
        // Still to be reviewed: the strongest candidate (the list is sorted strongest first), not the recording.
        expect(picardTargetFor({ candidates, recordingId: "rec" })).toEqual({
            url: "http://127.0.0.1:8000/openalbum?id=cand-1",
            kind: "candidate",
        });
        // No release of any kind: only then the recording.
        expect(picardTargetFor({ candidates: [], recordingId: "rec" })).toEqual({
            url: "http://127.0.0.1:8000/opennat?id=rec",
            kind: "recording",
        });
        expect(picardTargetFor({})).toBeUndefined();
    });

    test("a verdict waiting for review opens its best candidate release in Picard, not the recording", async () => {
        const { musicBrainzActionItems } = await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
        const task = await makeTask("t1");
        task.updateAttributes({
            musicBrainzIdentity: {
                verdict: "needsReview",
                decidedBy: "auto",
                checkedAt: "2026-11-11T10:00:00.000Z",
                recordingId: "rec-1",
                artists: [],
                candidates: [
                    { release: { id: "rel-best", title: "Night Drive", artists: [] }, evidence: ["url" as const] },
                    { release: { id: "rel-other", title: "Night Drive", artists: [] }, evidence: ["barcode" as const] },
                ],
                checks: [],
                evidence: [],
            },
        });
        const fake = await startFakePicard();
        const picard = musicBrainzActionItems(task).find((i) => i.id === "picard")!;
        expect(picard.description).toContain("best candidate release");
        picard.run();
        await fake.received(1);
        // Straight to Picard's local server: no browser involved.
        expect(fake.requests).toEqual(["/openalbum?id=rel-best"]);
        expect(openMock).not.toHaveBeenCalled();
    });

    test("the recording is opened only when no release is known (and says so)", async () => {
        const { musicBrainzActionItems } = await import("#flows/musicDownloadFlow/musicbrainz/columnActions");
        const task = await makeTask("t1");
        task.updateAttributes({
            musicBrainzIdentity: {
                verdict: "notFound",
                decidedBy: "auto",
                checkedAt: "2026-11-11T10:00:00.000Z",
                recordingId: "rec-1",
                artists: [],
                candidates: [],
                checks: [],
                evidence: [],
            },
        });
        const fake = await startFakePicard();
        const picard = musicBrainzActionItems(task).find((i) => i.id === "picard")!;
        expect(picard.description).toContain("no release is known");
        picard.run();
        await fake.received(1);
        // Straight to Picard's local server: no browser involved.
        expect(fake.requests).toEqual(["/opennat?id=rec-1"]);
        expect(openMock).not.toHaveBeenCalled();
    });
});

describe("talking to Picard directly", () => {
    const loadedTask = async () => {
        const task = await makeTask("t1");
        await task.checkMusicBrainz(); // matched
        return task;
    };
    const picardItem = async (task: DownloadTask) =>
        (await import("#flows/musicDownloadFlow/musicbrainz/columnActions"))
            .musicBrainzActionItems(task)
            .find((i) => i.id === "picard")!;

    test("Picard answering with a redirect (what it may do) counts as success: no message, no browser", async () => {
        const fake = await startFakePicard(302);
        const task = await loadedTask();
        (await picardItem(task)).run();
        await fake.received(1);
        await new Promise((r) => setTimeout(r, 50));
        expect(fake.requests).toEqual(["/openalbum?id=rel-1"]);
        expect(shown.confirm).toEqual([]);
        expect(openMock).not.toHaveBeenCalled();
    });

    test("nothing listening: a clear message says what to start and which port was tried — and no browser opens", async () => {
        const fake = await startFakePicard();
        const port = fake.port;
        await fake.close(); // Picard "not running": the port refuses connections
        const task = await loadedTask();
        (await picardItem(task)).run();
        for (let i = 0; i < 100 && shown.confirm.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
        expect(shown.confirm).toHaveLength(1);
        expect(shown.confirm[0].title).toBe("MusicBrainz Picard did not answer");
        expect(shown.confirm[0].message).toContain(`127.0.0.1:${port}`);
        expect(shown.confirm[0].message).toContain("Browser integration");
        expect(openMock).not.toHaveBeenCalled();
    });

    test("the port comes from the settings; a bad value means Picard's default", async () => {
        const { picardPort, sendToPicard } = await import("#flows/musicDownloadFlow/musicbrainz/picard");
        expect(picardPort("8123")).toBe(8123);
        expect(picardPort(" 9000 ")).toBe(9000);
        for (const bad of ["", "abc", "0", "70000", "-5", undefined, "80.5x"]) expect(picardPort(bad)).toBe(8000);

        const fake = await startFakePicard();
        expect(await sendToPicard(`http://127.0.0.1:${fake.port}/openalbum?id=x`)).toBe(true);
        await fake.close();
        expect(await sendToPicard(`http://127.0.0.1:${fake.port}/openalbum?id=x`)).toBe(false);
    });

    test("a Picard that does not answer in time is reported as unreachable, not waited for", async () => {
        const { sendToPicard } = await import("#flows/musicDownloadFlow/musicbrainz/picard");
        const silent = http.createServer(() => {}); // accepts the request and never answers
        await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
        const port = (silent.address() as AddressInfo).port;
        const started = Date.now();
        expect(await sendToPicard(`http://127.0.0.1:${port}/x`, 200)).toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
        silent.closeAllConnections();
        silent.close();
    });
});

// ── The releases' other pages (links on MusicBrainz) ─────────────────────────────────────

describe("external links of MusicBrainz releases", () => {
    const LINKS = [
        { url: { id: "u1", resource: "https://open.spotify.com/album/alb1" } },
        { url: { id: "u2", resource: "https://artist.bandcamp.com/album/night-drive" } },
        { url: { id: "u3", resource: "https://www.discogs.com/release/123" } },
    ];
    type FakeApi = { lookup: (...a: unknown[]) => Promise<unknown> };
    const fakeApi = () => (w.MusicBrainzClient as unknown as { api: FakeApi }).api;

    /** MusicBrainz knows these links for every release looked up by id; counts the lookups. */
    const withReleaseLinks = (relations: unknown[] = LINKS) => {
        const api = fakeApi();
        const lookup = api.lookup;
        const lookups: string[] = [];
        api.lookup = async (entity: unknown, id: unknown, ...rest: unknown[]) => {
            if (entity === "release") {
                lookups.push(String(id));
                return { ...MB_RELEASE, id, relations };
            }
            return lookup(entity, id, ...rest);
        };
        return lookups;
    };
    const needsReview = async () => {
        world.mbKnowsTheAlbum = false;
        world.barcodeHits = [DELUXE];
        const task = await makeTask("t1");
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        expect(identityOf(task)?.verdict).toBe("needsReview");
        return task;
    };

    test("the review loads each candidate's links and shows them, with the app address when there is one", async () => {
        const lookups = withReleaseLinks();
        const task = await needsReview();
        script.list = [null];
        await actions.reviewMusicBrainzRelease(task);

        const [item] = shown.list[0].items;
        expect(item.links?.map((l) => l.label)).toEqual(["Spotify", "Bandcamp", "Discogs"]);
        expect(item.links?.[0]).toMatchObject({
            url: "https://open.spotify.com/album/alb1",
            openUrl: "spotify:album:alb1", // opens in the Spotify app
        });
        expect(item.links?.[1].openUrl).toBe(item.links?.[1].url); // Bandcamp has no app: the page
        expect(lookups).toContain("rel-deluxe");
    });

    test("the links are kept on the verdict: a second review asks MusicBrainz nothing", async () => {
        const lookups = withReleaseLinks();
        const task = await needsReview();
        script.list = [null, null];
        await actions.reviewMusicBrainzRelease(task);
        const after = lookups.length;
        await actions.reviewMusicBrainzRelease(task);
        expect(lookups.length).toBe(after);
        expect(shown.list[1].items[0].links).toHaveLength(3);
    });

    test("a release whose links cannot be loaded is still reviewed, without links", async () => {
        const api = fakeApi();
        const lookup = api.lookup;
        api.lookup = async (entity: unknown, id: unknown, ...rest: unknown[]) => {
            if (entity === "release") throw new Error("503");
            return lookup(entity, id, ...rest);
        };
        const task = await needsReview();
        script.list = [null];
        await actions.reviewMusicBrainzRelease(task);
        expect(shown.list).toHaveLength(1);
        expect(shown.list[0].items[0].links).toEqual([]);
    });

    test("'Pages' on a matched release lists them and opens the picked one in its app", async () => {
        withReleaseLinks();
        const task = await makeTask("t1");
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        expect(identityOf(task)?.verdict).toBe("matched");

        script.list = [{ index: 0 }];
        await actions.openMusicBrainzExternalLinks(task);

        expect(shown.list[0].items.map((i) => i.label)).toEqual(["Spotify  (opens in the app)", "Bandcamp", "Discogs"]);
        expect(openMock).toHaveBeenCalledTimes(1);
        expect(openMock).toHaveBeenCalledWith("spotify:album:alb1");
    });

    test("dismissing it opens nothing", async () => {
        withReleaseLinks();
        const task = await makeTask("t1");
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        script.list = [null];
        await actions.openMusicBrainzExternalLinks(task);
        expect(openMock).not.toHaveBeenCalled();
    });

    test("a release with no links says so", async () => {
        withReleaseLinks([]);
        const task = await makeTask("t1");
        orchestrator.setTasks([task]);
        await task.checkMusicBrainz();
        // (A release found through its streaming link has that one link; this one was matched some other way.)
        task.updateAttributes({
            musicBrainzIdentity: {
                ...identityOf(task)!,
                release: { id: "rel-bare", title: "Bare", artists: [] },
            },
        });
        await actions.openMusicBrainzExternalLinks(task);
        expect(shown.list).toEqual([]);
        expect(shown.confirm.at(-1)?.title).toBe("No other pages");
    });
});

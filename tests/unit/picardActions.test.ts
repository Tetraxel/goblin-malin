import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { actionsMenuRegistry } from "#base/actionsMenu";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { TaskOrchestrator } from "#base/task/orchestrator";
import {
    describePicardBatch,
    openAllInPicard,
    picardTargetOfTask,
    planPicardBatch,
    planPicardBatchForList,
} from "#flows/musicDownloadFlow/musicbrainz/picardActions";
import {
    picardOpenRecordingUrl,
    picardOpenReleaseUrl,
    type PicardTarget,
} from "#flows/musicDownloadFlow/musicbrainz/picard";
import type { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";

const sendToPicard = vi.hoisted(() => vi.fn<(url: string) => Promise<boolean>>());
vi.mock("#flows/musicDownloadFlow/musicbrainz/picard", async (importOriginal) => ({
    ...(await importOriginal<typeof import("#flows/musicDownloadFlow/musicbrainz/picard")>()),
    sendToPicard,
}));

const release = (id: string): PicardTarget => ({ url: picardOpenReleaseUrl(id), kind: "release" });
const candidate = (id: string): PicardTarget => ({ url: picardOpenReleaseUrl(id), kind: "candidate" });
const recording = (id: string): PicardTarget => ({ url: picardOpenRecordingUrl(id), kind: "recording" });

/** A track as far as Picard is concerned: what the MusicBrainz check concluded. */
const track = (attrs: Record<string, unknown> = {}) =>
    ({ getAttributes: () => ({ kind: "track", ...attrs }) }) as unknown as DownloadTask;
const matched = (releaseId: string) =>
    track({ musicBrainzIdentity: { verdict: "matched", release: { id: releaseId } } });

describe("planPicardBatch", () => {
    test("loads a release once, however many tracks share it", () => {
        const plan = planPicardBatch([release("a"), release("a"), release("b"), release("a")]);
        expect(plan.targets.map((t) => t.url)).toEqual([release("a").url, release("b").url]);
        expect(plan.tracksWithTarget).toBe(4);
        expect(plan.tracksWithoutTarget).toBe(0);
    });

    test("counts the tracks with nothing to load, and keeps the order of the list", () => {
        const plan = planPicardBatch([undefined, recording("r1"), undefined, release("a")]);
        expect(plan.targets.map((t) => t.kind)).toEqual(["recording", "release"]);
        expect(plan.tracksWithTarget).toBe(2);
        expect(plan.tracksWithoutTarget).toBe(2);
    });

    test("an empty list is an empty plan", () => {
        expect(planPicardBatch([])).toEqual({ targets: [], tracksWithTarget: 0, tracksWithoutTarget: 0 });
    });
});

describe("describePicardBatch", () => {
    test("says what is loaded, and what is left out", () => {
        const text = describePicardBatch(planPicardBatch([release("a"), release("a"), recording("r"), undefined]));
        expect(text).toContain("Load 1 release and 1 recording in MusicBrainz Picard, for 3 tracks?");
        expect(text).toContain("share one release");
        expect(text).toContain("1 track with no MusicBrainz match yet will be left out");
        expect(text).toContain("browser integration");
    });

    test("only mentions what is true: no sharing, nothing left out, no candidates", () => {
        const text = describePicardBatch(planPicardBatch([release("a"), release("b")]));
        expect(text).toContain("Load 2 releases");
        expect(text).not.toContain("share one release");
        expect(text).not.toContain("left out");
        expect(text).not.toContain("candidate");
    });

    test("warns that a candidate is only a guess Picard will load, not something saved", () => {
        expect(describePicardBatch(planPicardBatch([candidate("a")]))).toContain("best candidate");
    });
});

describe("picardTargetOfTask", () => {
    test("prefers the matched release, then a candidate, then the recording", () => {
        expect(picardTargetOfTask(matched("rel"), 8000)).toEqual(release("rel"));
        const review = track({
            musicBrainzIdentity: {
                verdict: "needsReview",
                candidates: [{ release: { id: "cand" } }],
                recordingId: "rec",
            },
        });
        expect(picardTargetOfTask(review, 8000)).toEqual(candidate("cand"));
        expect(
            picardTargetOfTask(track({ musicBrainzIdentity: { verdict: "notFound", recordingId: "rec" } }), 8000)
        ).toEqual(recording("rec"));
    });

    test("falls back to the recording the discovery found when the verdict has none", () => {
        const task = track({ discoveryAnchors: { musicBrainz: { id: "anchor-rec" } } });
        expect(picardTargetOfTask(task, 8000)).toEqual(recording("anchor-rec"));
    });

    test("is the address on the port from the settings", () => {
        expect(picardTargetOfTask(matched("rel"), 8123)?.url).toBe("http://127.0.0.1:8123/openalbum?id=rel");
    });

    test("nothing known, nothing to load", () => {
        expect(picardTargetOfTask(track(), 8000)).toBeUndefined();
    });
});

describe("opening the whole list in Picard", () => {
    let tasks: unknown[];
    let confirm: ReturnType<typeof vi.spyOn>;
    let answers: (number | null)[];

    beforeEach(() => {
        tasks = [];
        answers = [];
        sendToPicard.mockReset();
        sendToPicard.mockResolvedValue(true);
        vi.spyOn(TaskOrchestrator, "getInstance").mockReturnValue({ getTasks: () => tasks } as never);
        confirm = vi.spyOn(dialogBridge, "confirm").mockImplementation(async () => answers.shift() ?? null);
    });
    afterEach(() => vi.restoreAllMocks());

    test("the list's plan skips albums, playlists and groups: only tracks are loaded", () => {
        tasks = [
            matched("a"),
            { getAttributes: () => ({ kind: "collection", collectionKind: "album" }) },
            matched("b"),
            track(),
        ];
        const plan = planPicardBatchForList();
        expect(plan.targets).toHaveLength(2);
        expect(plan.tracksWithoutTarget).toBe(1);
    });

    test("asks first, then sends each release once, in the order of the list", async () => {
        tasks = [matched("a"), matched("b"), matched("a")];
        answers = [0];

        await openAllInPicard();

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm.mock.calls[0][0]).toMatchObject({
            title: "Open all tracks in MusicBrainz Picard",
            choices: [{ label: "Open 2", tone: "primary" }, { label: "Cancel" }],
        });
        expect(sendToPicard.mock.calls.map(([url]) => url)).toEqual([release("a").url, release("b").url]);
    });

    test("sends nothing when the user cancels, or when nobody answers", async () => {
        tasks = [matched("a")];
        answers = [1];
        await openAllInPicard();
        answers = [null];
        await openAllInPicard();
        expect(sendToPicard).not.toHaveBeenCalled();
    });

    test("with no track matched, says so instead of asking", async () => {
        tasks = [track(), track()];
        answers = [0];

        await openAllInPicard();

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm.mock.calls[0][0].title).toBe("Nothing to open in Picard");
        expect(sendToPicard).not.toHaveBeenCalled();
    });

    test("stops at the first release Picard does not answer, and explains how to turn Picard on", async () => {
        tasks = [matched("a"), matched("b"), matched("c")];
        answers = [0, 0];
        sendToPicard.mockResolvedValueOnce(true).mockResolvedValue(false);

        await openAllInPicard();

        expect(sendToPicard).toHaveBeenCalledTimes(2);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(confirm.mock.calls[1][0].title).toBe("MusicBrainz Picard did not answer");
    });
});

describe("the actions menu registry", () => {
    afterEach(() => actionsMenuRegistry.clear());

    test("lists items in the order they were registered, and registering an id again replaces it", () => {
        const run = () => undefined;
        actionsMenuRegistry.register({ id: "a", label: "A", description: "first", run });
        actionsMenuRegistry.register({ id: "b", label: "B", description: "second", run });
        actionsMenuRegistry.register({ id: "a", label: "A2", description: "replaced", run });

        expect(actionsMenuRegistry.list().map((item) => `${item.id}:${item.label}`)).toEqual(["a:A2", "b:B"]);
    });

    test("the music app offers 'Open all tracks in MusicBrainz Picard', unavailable until a track has a match", async () => {
        const { registerActionsMenuItems } = await import("#flows/musicDownloadFlow/actionsMenuItems");
        registerActionsMenuItems();
        const item = actionsMenuRegistry.list().find((i) => i.id === "picard.openAll")!;
        expect(item.label).toBe("Open all tracks in MusicBrainz Picard");

        vi.spyOn(TaskOrchestrator, "getInstance").mockReturnValue({ getTasks: () => [track()] } as never);
        expect(item.unavailableReason?.()).toMatch(/No track has a MusicBrainz match/);
        vi.spyOn(TaskOrchestrator, "getInstance").mockReturnValue({ getTasks: () => [matched("a")] } as never);
        expect(item.unavailableReason?.()).toBeUndefined();
        vi.restoreAllMocks();
    });
});

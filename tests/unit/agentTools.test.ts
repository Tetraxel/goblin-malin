import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { AgentTurn } from "#base/agent/agentTurn";
import { taskLocks } from "#base/task/taskLock";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { urlParserRegistry } from "#base/urlParser";
import { runSelected } from "#flows/musicDownloadFlow/runController";
import { runAllowance } from "#flows/musicDownloadFlow/agent/runAllowance";
import { agentJournal } from "#flows/musicDownloadFlow/agent/taskAccess";
import { batchPlans } from "#flows/musicDownloadFlow/agent/batchPlans";
import { DownloadTask, runUserEdit, TaskLockedError } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeTaskRevision, downloadSourceIds } from "#flows/musicDownloadFlow/utils/taskRevision";
import { downloadedRow, installWorld, makeTrack, meta, callTool } from "./helpers/agentWorld";

// Starting a run would really process the track (network): the controller is replaced by a recorder.
vi.mock("#flows/musicDownloadFlow/runController", () => ({
    runSelected: vi.fn(async () => undefined),
    runAll: vi.fn(),
    stopAll: vi.fn(),
}));

let a: DownloadTask;
let b: DownloadTask;
let c: DownloadTask;

beforeAll(async () => {
    const { SettingsStore } = await import("#settings/settingsStore");
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
});

beforeEach(() => {
    a = makeTrack("aaa1", "First Song (Official Video)");
    b = makeTrack("bbb2", "Second Song [Lyrics] (HD)");
    c = makeTrack("ccc3", "Clean Title");
    installWorld([a, b, c]);
});

afterEach(() => {
    dialogBridge.setConfirmOpener(null);
});

/** A UI that answers every dialog with the button at `index` (and remembers what it was asked). */
function answerDialogs(index: number | null): { asked: string[] } {
    const asked: string[] = [];
    dialogBridge.setConfirmOpener((dialog, resolve) => {
        asked.push(`${dialog.title} | ${dialog.choices.map((x) => x.label).join("/")}`);
        resolve(index);
    });
    return { asked };
}

const overrideOf = (t: DownloadTask) => t.getAttributes()?.metadataOverride;

describe("reading", () => {
    test("list_tasks filters, and finds the titles with video-site noise", async () => {
        const all = await callTool("list_tasks", {});
        expect(all.json.total).toBe(3);
        expect(all.json.tasks[0]).toMatchObject({ id: "aaa1", kind: "track", title: "First Song (Official Video)" });

        const noisy = await callTool("list_tasks", { filter: { problem: "title_noise" } });
        expect(noisy.json.tasks.map((t: { id: string }) => t.id)).toEqual(["aaa1", "bbb2"]);

        const byText = await callTool("list_tasks", { filter: { query: "clean" } });
        expect(byText.json.tasks.map((t: { id: string }) => t.id)).toEqual(["ccc3"]);
        expect((await callTool("list_tasks", { filter: { ids: ["bbb2"] } })).json.total).toBe(1);
    });

    test("list_tasks pages, with a cursor", async () => {
        const many = Array.from({ length: 30 }, (_, i) => makeTrack(`t${i}`, `Song ${i}`));
        installWorld(many);
        const first = await callTool("list_tasks", {});
        expect(first.json.tasks).toHaveLength(25);
        expect(first.json.next).toBe("25");
        const second = await callTool("list_tasks", { cursor: first.json.next });
        expect(second.json.tasks).toHaveLength(5);
        expect(second.json.next).toBeUndefined();
    });

    test("get_task returns what the write tools need: the revision", async () => {
        const view = await callTool("get_task", { taskId: "aaa1" });
        expect(view.json.revision).toBe(a.getRevision());
        expect(view.json.compiled.title).toBe("First Song (Official Video)");
        expect(view.json.platforms[0].service).toBe("spotify");
        expect((await callTool("get_task", { taskId: "nope" })).text).toMatch(/No task with id/);
    });

    test('a task id given without its "task:" prefix is the same task (a model may drop it)', async () => {
        const real = makeTrack("task:3d6da40a5c5c", "Toc toc");
        installWorld([real, a]);
        expect((await callTool("get_task", { taskId: "task:3d6da40a5c5c" })).json.revision).toBe(real.getRevision());
        expect((await callTool("get_task", { taskId: "3d6da40a5c5c" })).json.revision).toBe(real.getRevision());
        const listed = await callTool("list_tasks", { filter: { ids: ["3d6da40a5c5c"] } });
        expect(listed.json.tasks.map((t: { id: string }) => t.id)).toEqual(["task:3d6da40a5c5c"]);
        // An id that is not a prefix away from a task is still not found.
        expect((await callTool("get_task", { taskId: "3d6da40a5c5" })).isError).toBe(true);
        // Whether the task is held is read on its real id too.
        const lease = taskLocks.acquire(["task:3d6da40a5c5c"], "user");
        expect((await callTool("get_task", { taskId: "3d6da40a5c5c" })).json.locked).toBe(true);
        if (lease.ok) lease.lease.release();
    });

    test("an unknown task or a bad input is an error the model can read", async () => {
        expect((await callTool("get_task", {})).text).toMatch(/taskId is required/);
        expect((await callTool("get_sources", { taskId: "nope" })).isError).toBe(true);
    });
});

describe("revisions", () => {
    test("they follow what the user can edit, not status or progress", () => {
        const row = downloadedRow("ytdlp", "https://youtu.be/x", meta("aaa1", "x"));
        const t = makeTrack("rev1", "Song", { downloadSources: [{ ...row, state: "downloading", progress: 10 }] });
        const before = t.getRevision();
        // A download progress tick changes the task, but not what a reader saw.
        t.updateAttributes({ downloadSources: [{ ...t.getAttributes()!.downloadSources[0], progress: 55 }] });
        expect(t.getRevision()).toBe(before);
        t.updateAttributes({ downloadsFetched: true });
        expect(t.getRevision()).toBe(before);
        // An edit does.
        t.setMetadataOverride({ trackName: "New" });
        expect(t.getRevision()).not.toBe(before);
        // Back to the same content: the same revision (what a reader of it saw is true again).
        t.setMetadataOverride({});
        expect(t.getRevision()).toBe(before);
    });

    test("a row keeps its id when its download finishes", () => {
        const track = meta("aaa1", "x");
        const searching = { ...downloadedRow("ytdlp", "x", track), candidate: undefined, localFile: undefined };
        const finished = {
            ...searching,
            state: "downloaded" as const,
            localFile: {
                state: "found" as const,
                path: "/tmp/x.flac",
                name: "x",
                extension: "flac" as const,
                sourceUrl: "https://youtu.be/other",
            },
        };
        expect(downloadSourceIds([finished])).toEqual(downloadSourceIds([searching]));
    });

    test("rows are told apart by what they are, not by their place", () => {
        const track = meta("aaa1", "x");
        const rows = [
            downloadedRow("soulseek", "a.flac", track),
            downloadedRow("soulseek", "b.flac", track),
            downloadedRow("soulseek", "a.flac", track),
        ];
        const ids = downloadSourceIds(rows);
        expect(new Set(ids).size).toBe(3);
        expect(ids[0]).toBe("soulseek|someuser|a.flac");
        expect(ids[2]).toBe("soulseek|someuser|a.flac#2");
        expect(computeTaskRevision(makeTrack("r", "s", { downloadSources: rows }).getAttributes()!)).toBeTypeOf(
            "number"
        );
    });
});

describe("set_metadata_override", () => {
    test("changes the metadata and answers with the new revision, which the next write can use", async () => {
        const first = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { trackName: "First Song", artists: ["Some Artist", "Guest"] },
        });
        expect(first.isError).toBe(false);
        expect(overrideOf(a)).toMatchObject({ trackName: "First Song" });
        expect(overrideOf(a)?.artists?.map((x) => x.name)).toEqual(["Some Artist", "Guest"]);
        expect(first.json.revision).toBe(a.getRevision());

        const second = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: first.json.revision,
            patch: { year: 2020 },
            clear: ["artists"],
        });
        expect(second.isError).toBe(false);
        expect(overrideOf(a)).toEqual({ trackName: "First Song", year: 2020 });
    });

    test("a write based on an out-of-date read is refused", async () => {
        const read = a.getRevision();
        a.setMetadataOverride({ trackName: "The user typed this" });
        const result = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: read,
            patch: { trackName: "Claude" },
        });
        expect(result.isError).toBe(true);
        expect(result.text).toMatch(/changed since you read it/);
        expect(overrideOf(a)?.trackName).toBe("The user typed this");
    });

    test("a task the pipeline is processing refuses the agent, but reads stay allowed", async () => {
        a.updateAttributes({ state: "running" });
        const result = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { year: 1999 },
        });
        expect(result.text).toMatch(/being processed right now/);
        expect(overrideOf(a)).toEqual({});
        expect((await callTool("get_task", { taskId: "aaa1" })).json.running).toBe(true);
    });

    test("values are checked like a user edit: the model is told why a value is refused", async () => {
        const bad = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { isrc: "not-an-isrc" },
        });
        expect(bad.isError).toBe(true);
        expect(bad.text).toMatch(/ISRC must be 12 characters/);
        const wrongType = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { year: "2020" },
        });
        expect(wrongType.text).toMatch(/input.patch.year must be a number/);
        expect(overrideOf(a)).toEqual({});

        const ok = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { isrc: "frt-09 2400049" },
        });
        expect(overrideOf(a)?.isrc).toBe("FRT092400049");
        expect(ok.isError).toBe(false);
    });

    test("an override an older version stored does not make an unrelated edit fail", async () => {
        a.updateAttributes({ metadataOverride: { isrc: "legacy-bad" } });
        const result = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { year: 2001 },
        });
        expect(result.isError).toBe(false);
        expect(overrideOf(a)).toEqual({ isrc: "legacy-bad", year: 2001 });
    });

    test("something to set or clear is needed, and a field cannot be both", async () => {
        const rev = a.getRevision();
        expect((await callTool("set_metadata_override", { taskId: "aaa1", revision: rev })).text).toMatch(
            /patch or clear/
        );
        expect(
            (
                await callTool("set_metadata_override", {
                    taskId: "aaa1",
                    revision: rev,
                    patch: { year: 2000 },
                    clear: ["year"],
                })
            ).text
        ).toMatch(/both set and cleared/);
    });

    test("a collection is not a track", async () => {
        const { CollectionTask } = await import("#flows/musicDownloadFlow/utils/collectionTask");
        const { globalLogger } = await import("#base/logger/logger");
        const album = new CollectionTask({
            id: "alb1",
            initialInput: "https://open.spotify.com/album/x",
            attributes: {
                kind: "collection",
                collectionKind: "album",
                state: "finished",
                userInput: { type: "url", url: "https://open.spotify.com/album/x" },
                childTaskIds: ["aaa1"],
            },
            logger: globalLogger,
        });
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        TaskOrchestrator.getInstance().setTasks([album as never, a]);
        const result = await callTool("set_metadata_override", { taskId: "alb1", revision: 0, patch: { year: 2000 } });
        expect(result.text).toMatch(/album\/playlist, not a track/);
        expect((await callTool("get_task", { taskId: "alb1" })).json.childIds).toEqual(["aaa1"]);
    });
});

describe("locks and the budget", () => {
    test("while Claude holds a task the user's edits are refused, without changing anything", async () => {
        const turn = new AgentTurn();
        const got = turn.acquire(["aaa1"]);
        expect("lease" in got).toBe(true);
        expect(() => a.setMetadataOverride({ year: 2000 })).toThrow(TaskLockedError);
        expect(runUserEdit(() => a.setMetadataOverride({ year: 2000 }))).toBe(false);
        expect(runUserEdit(() => a.selectDownloadSource(0))).toBe(false);
        expect(a.isLockedFor("user")).toBe(true);
        expect(overrideOf(a)).toEqual({});
        turn.end();
        expect(runUserEdit(() => a.setMetadataOverride({ year: 2000 }))).toBe(true);
        expect(overrideOf(a)).toEqual({ year: 2000 });
    });

    test("a task the user holds is not written by the agent", async () => {
        taskLocks.acquire(["aaa1"], "user");
        const result = await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { year: 2000 },
        });
        expect(result.text).toMatch(/being edited by someone else/);
        expect(overrideOf(a)).toEqual({});
    });

    test("the lease is given back after every call, so the user is never locked out afterwards", async () => {
        await callTool("set_metadata_override", { taskId: "aaa1", revision: a.getRevision(), patch: { year: 2000 } });
        await callTool("set_metadata_override", { taskId: "aaa1", revision: 1, patch: { year: 2001 } });
        expect(taskLocks.isLocked("aaa1")).toBe(false);
    });

    test("one turn cannot rewrite the same task over and over", async () => {
        const turn = new AgentTurn();
        let last: Awaited<ReturnType<typeof callTool>> | undefined;
        for (let i = 0; i < 9; i++) {
            last = await callTool(
                "set_metadata_override",
                { taskId: "aaa1", revision: a.getRevision(), patch: { year: 2000 + i } },
                turn
            );
        }
        expect(last?.isError).toBe(true);
        expect(last?.text).toMatch(/already been changed 8 times/);
        expect(overrideOf(a)?.year).toBe(2007);
    });
});

describe("undo", () => {
    test("puts the overrides back", async () => {
        a.setMetadataOverride({ trackName: "Hand typed" });
        await callTool("set_metadata_override", {
            taskId: "aaa1",
            revision: a.getRevision(),
            patch: { trackName: "Claude's", year: 1999 },
        });
        expect(overrideOf(a)).toMatchObject({ trackName: "Claude's", year: 1999 });
        expect(agentJournal.last()?.label).toMatch(/set_metadata_override/);
        expect(await agentJournal.undoLast()).toMatchObject({ done: true });
        expect(overrideOf(a)).toEqual({ trackName: "Hand typed" });
    });

    test("is refused once the user changed the task since", async () => {
        await callTool("set_metadata_override", { taskId: "aaa1", revision: a.getRevision(), patch: { year: 1999 } });
        a.setMetadataOverride({ ...overrideOf(a), trackName: "The user's own change" });
        expect(await agentJournal.undoLast()).toMatchObject({ done: false, reason: "changed" });
        expect(overrideOf(a)).toMatchObject({ year: 1999, trackName: "The user's own change" });
    });
});

describe("download sources", () => {
    function withRows() {
        const track = meta("aaa1", "First Song");
        const rows = [
            downloadedRow("ytdlp", "https://youtu.be/x", track),
            downloadedRow("soulseek", "song.flac", track),
        ];
        rows[1] = { ...rows[1], state: "failed" };
        a.updateAttributes({
            downloadSources: [{ ...rows[0], selected: true }, rows[1], downloadedRow("soulseek", "other.flac", track)],
        });
        return downloadSourceIds(a.getAttributes()!.downloadSources);
    }

    test("get_sources lists rows by a stable id", async () => {
        const ids = withRows();
        const view = await callTool("get_sources", { taskId: "aaa1" });
        expect(view.json.sources.map((s: { id: string }) => s.id)).toEqual(ids);
        expect(view.json.sources[0]).toMatchObject({ provider: "ytdlp", selected: true, format: "flac" });
    });

    test("select_source picks a downloaded row by id; a failed or unknown row is refused", async () => {
        const ids = withRows();
        const refused = await callTool("select_source", {
            taskId: "aaa1",
            sourceId: ids[1],
            revision: a.getRevision(),
        });
        expect(refused.text).toMatch(/"failed", not downloaded/);
        expect(
            (await callTool("select_source", { taskId: "aaa1", sourceId: "nope", revision: a.getRevision() })).text
        ).toMatch(/No download row/);

        const picked = await callTool("select_source", { taskId: "aaa1", sourceId: ids[2], revision: a.getRevision() });
        expect(picked.isError).toBe(false);
        expect(a.getAttributes()!.downloadSources.map((s) => s.selected)).toEqual([false, false, true]);

        expect(await agentJournal.undoLast()).toMatchObject({ done: true });
        expect(a.getAttributes()!.downloadSources.map((s) => s.selected)).toEqual([true, false, false]);
    });

    test("reject_source rejects and brings back, and can be undone", async () => {
        const ids = withRows();
        await callTool("reject_source", { taskId: "aaa1", sourceId: ids[0], revision: a.getRevision() });
        let rows = a.getAttributes()!.downloadSources;
        expect(rows[0]).toMatchObject({ isRejected: true, selected: false });
        expect(
            (await callTool("select_source", { taskId: "aaa1", sourceId: ids[0], revision: a.getRevision() })).text
        ).toMatch(/rejected/);

        await callTool("reject_source", {
            taskId: "aaa1",
            sourceId: ids[0],
            rejected: false,
            revision: a.getRevision(),
        });
        expect(a.getAttributes()!.downloadSources[0].isRejected).toBe(false);
        await agentJournal.undoLast();
        await agentJournal.undoLast();
        rows = a.getAttributes()!.downloadSources;
        expect(rows[0]).toMatchObject({ isRejected: false, selected: true });
    });
});

describe("the turn's budget", () => {
    test("a refused or invalid change does not use up the allowance of its task", async () => {
        const turn = new AgentTurn(taskLocks, { perTask: 2, tasks: 10 });
        for (let i = 0; i < 4; i++) {
            const bad = await callTool(
                "set_metadata_override",
                { taskId: "aaa1", revision: a.getRevision(), patch: { isrc: "not an isrc" } },
                turn
            );
            expect(bad.text).not.toMatch(/already been changed/);
            expect(bad.isError).toBe(true);
        }
        expect(turn.touched.get("aaa1")).toBeUndefined();
        const good = await callTool(
            "set_metadata_override",
            { taskId: "aaa1", revision: a.getRevision(), patch: { year: 2020 } },
            turn
        );
        expect(good.isError).toBe(false);
        expect(turn.touched.get("aaa1")).toBe(1);
    });

    test("a cancelled batch costs nothing, an applied one counts each task it changed", async () => {
        const turn = new AgentTurn(taskLocks, { perTask: 2, tasks: 10 });
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        answerDialogs(0);
        expect((await callTool("apply_batch", { planId: plan.json.planId }, turn)).json).toMatchObject({
            applied: 0,
            cancelled: true,
        });
        expect(turn.touched.size).toBe(0);

        const again = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        answerDialogs(1);
        expect((await callTool("apply_batch", { planId: again.json.planId }, turn)).json).toEqual({ applied: 2 });
        expect(turn.touched.get("aaa1")).toBe(1);
        expect(turn.touched.get("bbb2")).toBe(1);
    });
});

describe("a blank value in the panel", () => {
    test("a person may blank a tag; the title and the agent may not", () => {
        a.setMetadataOverride({ isrc: "", key: "  ", genres: [], artists: [] });
        expect(overrideOf(a)).toEqual({ isrc: "", key: "", genres: [], artists: [] });
        expect(() => a.setMetadataOverride({ trackName: "" })).toThrow(/cannot be empty/);
        a.setMetadataOverride({});
        expect(() => a.patchMetadataOverride({ isrc: "" }, { actor: "agent" })).toThrow(/cannot be empty/);
        expect(() => a.patchMetadataOverride({ genres: [] }, { actor: "agent" })).toThrow(/1 to 30/);
        // Whatever is not blank is still checked for a person.
        expect(() => a.setMetadataOverride({ isrc: "nope" })).toThrow(/ISRC/);
    });
});

describe("batches", () => {
    test("plan_bulk_override plans in code and changes nothing; apply_batch asks first, then applies", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        expect(plan.isError).toBe(false);
        expect(plan.json.tasks).toBe(2);
        expect(plan.json.diff.map((d: { changes: string[] }) => d.changes[0])).toEqual([
            "trackName: First Song (Official Video) → First Song",
            "trackName: Second Song [Lyrics] (HD) → Second Song",
        ]);
        expect(overrideOf(a)).toEqual({});

        const ui = answerDialogs(1);
        const applied = await callTool("apply_batch", { planId: plan.json.planId });
        expect(applied.json).toEqual({ applied: 2 });
        expect(ui.asked[0]).toBe("Apply 2 changes from Claude? | Cancel/Apply 2");
        expect(overrideOf(a)).toEqual({ trackName: "First Song" });
        expect(overrideOf(b)).toEqual({ trackName: "Second Song" });
        expect(overrideOf(c)).toEqual({});
        expect(taskLocks.isLocked("aaa1")).toBe(false);

        // One action: one undo reverts the whole batch.
        expect(await agentJournal.undoLast()).toMatchObject({ done: true });
        expect(overrideOf(a)).toEqual({});
        expect(overrideOf(b)).toEqual({});
    });

    test("the user can refuse, and nobody answering is a refusal too", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        answerDialogs(0);
        expect((await callTool("apply_batch", { planId: plan.json.planId })).json).toMatchObject({
            applied: 0,
            cancelled: true,
        });
        dialogBridge.setConfirmOpener(null);
        expect((await callTool("apply_batch", { planId: plan.json.planId })).json).toMatchObject({
            applied: 0,
            cancelled: true,
        });
        expect(overrideOf(a)).toEqual({});
    });

    test("a plan expires when a task of it changed in between", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        b.setMetadataOverride({ year: 2000 });
        answerDialogs(1);
        const result = await callTool("apply_batch", { planId: plan.json.planId });
        expect(result.text).toMatch(/plan expired: 1 task\(s\) changed/);
        expect(overrideOf(a)).toEqual({});
        // And it is gone: it cannot be applied by mistake later.
        expect((await callTool("apply_batch", { planId: plan.json.planId })).text).toMatch(/No plan/);
    });

    test("a task that changes while the dialog is open is not overwritten", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            a.setMetadataOverride({ year: 1990 });
            resolve(1);
        });
        const result = await callTool("apply_batch", { planId: plan.json.planId });
        expect(result.text).toMatch(/plan expired/);
        expect(overrideOf(a)).toEqual({ year: 1990 });
    });

    test("plan_batch plans what is asked, skipping what would change nothing or is not acceptable", async () => {
        a.updateAttributes({ state: "running" });
        const plan = await callTool("plan_batch", {
            summary: "fix",
            changes: [
                { taskId: "aaa1", patch: { trackName: "X" } },
                { taskId: "bbb2", patch: { trackName: "Second Song" } },
                { taskId: "ccc3", patch: { isrc: "bad" } },
                { taskId: "bbb2", patch: { year: 2000 } },
            ],
        });
        expect(plan.json.tasks).toBe(1);
        expect(plan.json.skipped.map((s: { reason: string }) => s.reason)).toEqual([
            "being processed",
            expect.stringMatching(/ISRC/),
            "listed twice",
        ]);
        expect(plan.json.diff[0].changes[0]).toBe("trackName: Second Song [Lyrics] (HD) → Second Song");
    });

    test("a part run started while the dialog is open makes the plan expire", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            // run_metadata on a finished track: its state stays "finished", only the part counter says it runs.
            Object.defineProperty(a, "partRunning", { get: () => true, configurable: true });
            resolve(1);
        });
        const result = await callTool("apply_batch", { planId: plan.json.planId });
        expect(result.text).toMatch(/plan expired: 1 task\(s\) changed .*being processed/);
        expect(overrideOf(a)).toEqual({});
        expect(overrideOf(b)).toEqual({});
    });

    test("an Apply given after Stop changes nothing", async () => {
        const plan = await callTool("plan_bulk_override", {
            filter: { problem: "title_noise" },
            titleCleanup: { removeNoise: true },
        });
        const turn = new AgentTurn();
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            turn.stop();
            resolve(1);
        });
        const result = await callTool("apply_batch", { planId: plan.json.planId }, turn);
        expect(result.json).toMatchObject({ applied: 0, cancelled: true });
        expect(result.json.note).toMatch(/moved on/);
        expect(overrideOf(a)).toEqual({});
    });

    test("plan_batch skips an unknown id, and an id written with and without task: is the same task", async () => {
        const d = makeTrack("task:ddd4", "Fourth Song");
        installWorld([a, b, c, d]);
        const plan = await callTool("plan_batch", {
            summary: "fix",
            changes: [
                { taskId: "nope", patch: { year: 2000 } },
                { taskId: "task:ddd4", patch: { year: 2001 } },
                { taskId: "ddd4", patch: { year: 2002 } },
            ],
        });
        expect(plan.isError).toBe(false);
        expect(plan.json.tasks).toBe(1);
        expect(plan.json.skipped.map((s: { reason: string }) => s.reason)).toEqual([
            expect.stringMatching(/No task with id "nope"/),
            "listed twice",
        ]);
    });

    test("plan_batch skips a malformed entry instead of losing the whole plan", async () => {
        const d = makeTrack("task:ddd4", "Fourth Song");
        installWorld([a, b, c, d]);
        const plan = await callTool("plan_batch", {
            summary: "fix",
            changes: [{ taskId: "bbb2" }, { taskId: "ddd4", patch: { year: 2001 } }],
        });
        expect(plan.isError).toBe(false);
        expect(plan.json.tasks).toBe(1);
        expect(plan.json.skipped).toEqual([{ taskId: "bbb2", reason: expect.stringMatching(/patch or clear/i) }]);
    });

    test("nothing to plan is an error, and a filter cannot reach past the cap", async () => {
        expect(
            (await callTool("plan_bulk_override", { filter: { query: "no such track" }, patch: { year: 2000 } })).text
        ).toMatch(/No track matches/);
        expect((await callTool("plan_bulk_override", { filter: {}, patch: {} })).isError).toBe(true);
        expect(
            (await callTool("plan_bulk_override", { filter: { ids: ["ccc3"] }, titleCleanup: { removeNoise: true } }))
                .text
        ).toMatch(/Nothing would change/);
        expect(batchPlans.get("plan-none")).toBeUndefined();
    });
});

describe("archive_tasks", () => {
    test("always asks, and without anyone to ask nothing is archived", async () => {
        dialogBridge.setConfirmOpener(null);
        const none = await callTool("archive_tasks", { taskIds: ["aaa1"] });
        expect(none.json).toMatchObject({ archived: 0, cancelled: true });
        const ui = answerDialogs(0);
        expect((await callTool("archive_tasks", { taskIds: ["aaa1", "bbb2"] })).json.archived).toBe(0);
        expect(ui.asked[0]).toBe("Let Claude archive 2 tasks? | Cancel/Archive");
    });

    test("a late answer archives nothing: after Stop, or when the tasks were started meanwhile", async () => {
        const turn = new AgentTurn();
        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            turn.stop();
            resolve(1);
        });
        const stopped = await callTool("archive_tasks", { taskIds: ["aaa1"] }, turn);
        expect(stopped.json).toMatchObject({ archived: 0, cancelled: true });

        dialogBridge.setConfirmOpener((_dialog, resolve) => {
            a.updateAttributes({ state: "running" });
            resolve(1);
        });
        expect((await callTool("archive_tasks", { taskIds: ["aaa1"] })).text).toMatch(/being processed right now/);
        expect(
            TaskOrchestrator.getInstance()
                .getTasks()
                .map((t) => t.getId())
        ).toContain("aaa1");
    });

    test("tasks being processed are left out", async () => {
        a.updateAttributes({ state: "running" });
        b.updateAttributes({ state: "running" });
        expect((await callTool("archive_tasks", { taskIds: ["aaa1", "bbb2"] })).text).toMatch(
            /being processed right now/
        );
    });
});

describe("add_user_source and rediscover", () => {
    test("an unreadable link is reported back, not stored", async () => {
        const result = await callTool("add_user_source", {
            taskId: "aaa1",
            revision: a.getRevision(),
            url: "https://example.com/x",
        });
        expect(result.isError).toBe(false);
        expect(result.json.added).toEqual([]);
        expect(result.json.skipped[0].reason).toMatch(/not a track link/);
        expect(a.getAttributes()?.userSources ?? []).toEqual([]);
    });

    test("rediscover refuses a provider it may not run, and a track with nothing to look up from", async () => {
        const noPrimary = makeTrack("np", "x", { primaryMetadataFetched: false, metadataGroups: [] });
        const { TaskOrchestrator } = await import("#base/task/orchestrator");
        TaskOrchestrator.getInstance().setTasks([noPrimary]);
        expect((await callTool("rediscover", { taskId: "np", revision: noPrimary.getRevision() })).text).toMatch(
            /no primary metadata/
        );
        TaskOrchestrator.getInstance().setTasks([a]);
        expect(
            (await callTool("rediscover", { taskId: "aaa1", revision: a.getRevision(), provider: "claude" })).text
        ).toMatch(/cannot be asked again/);
    });

    test("rediscover counts as a run: the track is busy for the writes and the runs until it is over", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const discovery = vi.spyOn(DownloadTask.prototype, "startMetadataDiscovering").mockImplementation(() => gate);
        try {
            const call = callTool("rediscover", { taskId: "aaa1", revision: a.getRevision() });
            await vi.waitFor(() => expect(discovery).toHaveBeenCalled());
            expect(a.partRunning).toBe(true);
            const write = await callTool("set_metadata_override", {
                taskId: "aaa1",
                revision: a.getRevision(),
                patch: { year: 2001 },
            });
            expect(write.text).toMatch(/being processed right now/);
            expect(overrideOf(a)).toEqual({});
            release();
            expect((await call).isError).toBe(false);
            expect(a.partRunning).toBe(false);
        } finally {
            release();
            discovery.mockRestore();
        }
    });

    test("lookup_url says so when no service reads the link", async () => {
        expect((await callTool("lookup_url", { url: "https://example.com/not-music" })).json).toMatchObject({
            recognized: false,
        });
    });
});

describe("search_music", () => {
    test("asks every platform that can search and answers with links the user can add", async () => {
        const spy = vi.spyOn(DownloadTask.prototype, "searchCatalog").mockResolvedValue([
            {
                platform: "spotify",
                results: [
                    {
                        ...meta("sp1", "Neverender (Remix)", "Justice"),
                        album: { id: "al", albumName: "Remixes", url: "u", uri: "u", releaseDate: "2017-03-01" },
                        duration: 200_000,
                    },
                ],
            },
            { platform: "youtube", results: [], error: "no network" },
        ]);
        try {
            const result = await callTool("search_music", { query: "Neverender Justice remix", limit: 5 });
            expect(result.isError).toBe(false);
            expect(spy).toHaveBeenCalledWith("Neverender Justice remix", { platforms: undefined, limit: 5 });
            expect(result.json.platforms[0]).toMatchObject({
                platform: "spotify",
                results: [
                    {
                        title: "Neverender (Remix)",
                        artists: ["Justice"],
                        album: "Remixes",
                        year: "2017",
                        url: "https://open.spotify.com/track/sp1",
                    },
                ],
            });
            expect(result.json.platforms[1]).toMatchObject({ platform: "youtube", error: "no network" });
        } finally {
            spy.mockRestore();
        }
    });

    test("says so when no platform can search, and refuses an empty query", async () => {
        const spy = vi.spyOn(DownloadTask.prototype, "searchCatalog").mockResolvedValue([]);
        try {
            expect((await callTool("search_music", { query: "anything" })).json.note).toMatch(/switched on/);
        } finally {
            spy.mockRestore();
        }
        expect((await callTool("search_music", { query: "" })).isError).toBe(true);
    });
});

describe("add_tasks", () => {
    beforeAll(() => {
        urlParserRegistry.register((url) =>
            url.startsWith("https://open.spotify.com/track/")
                ? { platform: "spotify", type: "track", id: url.split("/").pop() }
                : null
        );
    });
    const link = (id: string) => `https://open.spotify.com/track/${id}`;

    test("adds new links as tasks that are not started, and says why it skipped the others", async () => {
        const result = await callTool("add_tasks", {
            urls: [link("new1"), link("new2"), link("new1"), "https://example.com/x"],
        });
        expect(result.isError).toBe(false);
        expect(result.json.added.map((t: { url: string }) => t.url)).toEqual([link("new1"), link("new2")]);
        expect(result.json.skipped.map((s: { reason: string }) => s.reason)).toEqual([
            "given twice",
            "not a link of a platform the app reads",
        ]);
        const ids = TaskOrchestrator.getInstance()
            .getTasks()
            .map((t) => t.getId());
        expect(ids).toContain(result.json.added[0].taskId);
        const added = TaskOrchestrator.getInstance()
            .getTasks()
            .find((t) => t.getId() === result.json.added[0].taskId);
        expect(added?.getAttributes()?.state).toBe("pending");
    });

    test("is one /undo: the tasks nobody started are removed again", async () => {
        const before = TaskOrchestrator.getInstance().getTasks().length;
        await callTool("add_tasks", { urls: [link("u1"), link("u2")] });
        expect(TaskOrchestrator.getInstance().getTasks()).toHaveLength(before + 2);
        const undone = await agentJournal.undoLast();
        expect(undone.done).toBe(true);
        expect(TaskOrchestrator.getInstance().getTasks()).toHaveLength(before);
    });

    test("a link already in the list is not added twice", async () => {
        const first = await callTool("add_tasks", { urls: [link("dup1")] });
        const again = await callTool("add_tasks", { urls: [link("dup1")] });
        expect(first.json.added).toHaveLength(1);
        expect(again.json.added).toEqual([]);
        expect(again.json.skipped[0].reason).toBe("already in the list");
    });
});

describe("run_metadata, run_download and run_task", () => {
    let pending: DownloadTask;
    let ready: DownloadTask;

    beforeEach(() => {
        vi.mocked(runSelected).mockClear();
        runAllowance.reset();
        pending = makeTrack("pend1", "Not run yet", { state: "pending", toTag: false, toDownload: false });
        ready = makeTrack("ready1", "Ready", { metadataDiscovered: true });
        installWorld([pending, ready, a]);
    });

    test("run_metadata starts a track that was never run with downloads off, and runs the part again for one that was", async () => {
        const again = vi.spyOn(DownloadTask.prototype, "runMetadataPart").mockResolvedValue(undefined);
        try {
            const result = await callTool("run_metadata", { taskIds: ["pend1", "ready1", "nope"] });
            expect(result.isError).toBe(false);
            expect(pending.getAttributes()).toMatchObject({ toTag: true, toDownload: false });
            expect(runSelected).toHaveBeenCalledTimes(1);
            expect([...vi.mocked(runSelected).mock.calls[0][0]]).toEqual(["pend1"]);
            expect(again).toHaveBeenCalledTimes(1);
            expect(result.json.started).toEqual([
                { taskId: "pend1", how: "first run" },
                { taskId: "ready1", how: "again" },
            ]);
            expect(result.json.skipped).toEqual([{ taskId: "nope", reason: "no task with this id" }]);
            expect(result.json.note).toMatch(/background/);
        } finally {
            again.mockRestore();
        }
    });

    test("a track that never ran is not started while a batch is going: it is reported as skipped", async () => {
        const processing = vi.spyOn(TaskOrchestrator.prototype, "isProcessing").mockReturnValue(true);
        const again = vi.spyOn(DownloadTask.prototype, "runMetadataPart").mockResolvedValue(undefined);
        try {
            const result = await callTool("run_metadata", { taskIds: ["pend1", "ready1"] });
            expect(result.isError).toBe(false);
            expect(runSelected).not.toHaveBeenCalled();
            // A track already run does not go through the batch: it still starts.
            expect(result.json.started).toEqual([{ taskId: "ready1", how: "again" }]);
            expect(result.json.skipped).toEqual([
                { taskId: "pend1", reason: expect.stringMatching(/another batch is running/) },
            ]);
            expect(pending.getAttributes()).toMatchObject({ toTag: false });

            const onlyFresh = await callTool("run_metadata", { taskIds: ["pend1"] });
            expect(onlyFresh.json.started).toEqual([]);
        } finally {
            processing.mockRestore();
            again.mockRestore();
        }
    });

    test("a track that is being processed, or being edited by someone else, is not started", async () => {
        const running = makeTrack("run1", "Busy", { state: "running" });
        installWorld([running, pending]);
        taskLocks.acquire(["pend1"], "user");
        const result = await callTool("run_metadata", { taskIds: ["run1", "pend1"] });
        expect(result.json.started).toEqual([]);
        expect(result.json.skipped.map((s: { reason: string }) => s.reason)).toEqual([
            "already being processed",
            "being edited right now",
        ]);
        expect(runSelected).not.toHaveBeenCalled();
    });

    test("run_download asks first, with the safe answer first, and starts nothing when nobody answers", async () => {
        const part = vi.spyOn(DownloadTask.prototype, "runDownloadPart").mockResolvedValue(undefined);
        try {
            const { asked } = answerDialogs(null);
            const result = await callTool("run_download", { taskIds: ["ready1"] });
            expect(asked).toEqual(["Let Claude start 1 download? | Cancel/Start/Start, don't ask again"]);
            expect(result.json).toMatchObject({ started: [], cancelled: true });
            expect(part).not.toHaveBeenCalled();
        } finally {
            part.mockRestore();
        }
    });

    test("run_download starts the download part of tracks whose metadata is ready, and says why it left the others", async () => {
        const part = vi.spyOn(DownloadTask.prototype, "runDownloadPart").mockResolvedValue(undefined);
        try {
            answerDialogs(1);
            const result = await callTool("run_download", { taskIds: ["ready1", "pend1"] });
            expect(part).toHaveBeenCalledTimes(1);
            expect(result.json.started).toEqual([{ taskId: "ready1" }]);
            expect(result.json.skipped).toEqual([
                { taskId: "pend1", reason: "its metadata is not ready: run_metadata first" },
            ]);
        } finally {
            part.mockRestore();
        }
    });

    test("'don't ask again' lasts for the conversation: the next download starts without a dialog, a new one asks again", async () => {
        const part = vi.spyOn(DownloadTask.prototype, "runDownloadPart").mockResolvedValue(undefined);
        try {
            const first = answerDialogs(2);
            await callTool("run_download", { taskIds: ["ready1"] });
            expect(first.asked).toHaveLength(1);
            const second = answerDialogs(0);
            const again = await callTool("run_download", { taskIds: ["ready1"] });
            expect(second.asked).toEqual([]);
            expect(again.json.started).toEqual([{ taskId: "ready1" }]);
            runAllowance.reset();
            await callTool("run_download", { taskIds: ["ready1"] });
            expect(second.asked).toHaveLength(1);
        } finally {
            part.mockRestore();
        }
    });

    test("run_task runs a track that was never run from start to end, and refuses one that was run before", async () => {
        answerDialogs(1);
        const result = await callTool("run_task", { taskIds: ["pend1", "ready1"] });
        expect(pending.getAttributes()).toMatchObject({ toTag: true, toDownload: true });
        expect([...vi.mocked(runSelected).mock.calls[0][0]]).toEqual(["pend1"]);
        expect(result.json.started).toEqual([{ taskId: "pend1" }]);
        expect(result.json.skipped[0]).toMatchObject({ taskId: "ready1" });
        expect(result.json.skipped[0].reason).toMatch(/already run/);
        // Cancelled: the flags stay as the user left them.
        const other = makeTrack("pend2", "Other", { state: "pending", toTag: false, toDownload: false });
        installWorld([other]);
        answerDialogs(0);
        await callTool("run_task", { taskIds: ["pend2"] });
        expect(other.getAttributes()).toMatchObject({ toTag: false, toDownload: false });
    });
});

describe("asking before a download", () => {
    let pending: DownloadTask;

    beforeEach(() => {
        vi.mocked(runSelected).mockClear();
        runAllowance.reset();
        pending = makeTrack("ask1", "Not run yet", { state: "pending", toTag: false, toDownload: false });
        installWorld([pending]);
    });

    /** A UI that keeps the dialog open until `answer` is called. */
    function holdDialog(): { asked: string[]; answer: (index: number | null) => void } {
        const asked: string[] = [];
        let resolveDialog: (index: number | null) => void = () => undefined;
        dialogBridge.setConfirmOpener((dialog, resolve) => {
            asked.push(dialog.message);
            resolveDialog = resolve;
        });
        return { asked, answer: (index) => resolveDialog(index) };
    }

    test("a call made again while the first still waits joins it: one dialog, one run", async () => {
        const ui = holdDialog();
        // The CLI gives up on the call and the model makes it again, in the same message (turn).
        const turn = new AgentTurn();
        const first = callTool("run_task", { taskIds: ["ask1"] }, turn);
        const again = callTool("run_task", { taskIds: ["ask1"] }, turn);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(ui.asked).toHaveLength(1);
        ui.answer(1);
        const [a, b] = await Promise.all([first, again]);
        expect(a.json).toEqual(b.json);
        expect(a.json.started).toEqual([{ taskId: "ask1" }]);
        expect(runSelected).toHaveBeenCalledTimes(1);
    });

    test("the dialog names the tracks by their title or link, not by an internal address", async () => {
        const ui = holdDialog();
        const pendingCall = callTool("run_task", { taskIds: ["ask1"] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(ui.asked[0]).toContain("• Not run yet");
        ui.answer(0);
        await pendingCall;
    });

    test("a track that was not read yet is named by a short link, so each one stays on its line", async () => {
        const fresh = makeTrack("link1", "x", { state: "pending", metadataGroups: [], primaryMetadataFetched: false });
        fresh.updateAttributes({
            userInput: { type: "url", url: "https://open.spotify.com/track/5EtJ3keh0umOlQ0kHXvNIS?si=abcdef" },
        });
        installWorld([fresh]);
        const ui = holdDialog();
        const call = callTool("run_task", { taskIds: ["link1"] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const line = ui.asked[0].split("\n").find((l) => l.startsWith("• "))!;
        expect(line.startsWith("• open.spotify.com/track/5EtJ3keh0um")).toBe(true);
        expect(line.endsWith("…")).toBe(true);
        expect(line.length).toBeLessThanOrEqual(2 + 44);
        expect(ui.asked[0]).not.toContain("https://");
        ui.answer(0);
        await call;
    });

    test("an answer that comes after the turn ended starts nothing", async () => {
        const ui = holdDialog();
        const { AgentTurn } = await import("#base/agent/agentTurn");
        const turn = new AgentTurn();
        const call = callTool("run_task", { taskIds: ["ask1"] }, turn);
        await new Promise((resolve) => setTimeout(resolve, 20));
        turn.end();
        ui.answer(1);
        const result = await call;
        expect(result.json).toMatchObject({ started: [], cancelled: true });
        expect(runSelected).not.toHaveBeenCalled();
        expect(pending.getAttributes()).toMatchObject({ toDownload: false });
    });

    test("a track another run started while the question was open is not started again", async () => {
        const ui = holdDialog();
        const call = callTool("run_task", { taskIds: ["ask1"] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        pending.updateAttributes({ state: "running" });
        ui.answer(1);
        const result = await call;
        expect(result.json.started).toEqual([]);
        expect(runSelected).not.toHaveBeenCalled();
    });
});

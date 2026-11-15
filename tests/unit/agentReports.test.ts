import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "#settings/settingsStore";
import { AgentLog } from "#flows/musicDownloadFlow/agent/agentLog";
import { type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { downloadedRow, installWorld, makeTrack, meta, callTool } from "./helpers/agentWorld";

beforeAll(() => {
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
});

afterEach(() => vi.useRealTimers());

/** A track whose metadata was found and whose downloads were searched, with these download rows. */
const downloaded = (id: string, rows: TrackDownloadSource[], patch = {}) =>
    makeTrack(id, "Song", {
        state: "finished",
        metadataDiscovered: true,
        downloadsFetched: true,
        downloadSources: rows,
        ...patch,
    });

const goodRow = (id: string, durationMs = 200_000): TrackDownloadSource => ({
    ...downloadedRow("ytdlp", "song.flac", meta(id, "Song")),
    selected: true,
    fileInfo: { format: "flac", sizeBytes: 1, durationMs, embeddedTags: {}, provenance: "lossless" },
});

describe("wait_for_tasks", () => {
    test("answers at once for tracks nothing is running on, with how each one stands", async () => {
        const ok = downloaded("ok1", [goodRow("ok1")], { metadataOverride: { duration: 200_000 } });
        const idle = makeTrack("idle1", "Never run", { state: "pending", primaryMetadataFetched: false });
        installWorld([ok, idle]);
        const result = await callTool("wait_for_tasks", { taskIds: ["ok1", "idle1", "nope"] });
        expect(result.isError).toBe(false);
        expect(result.json.done).toBe(true);
        expect(result.json.summary).toMatchObject({ ok: 1, not_run: 1, failed: 0, still_running: 0 });
        expect(result.json.tasks[0]).toMatchObject({ taskId: "ok1", verdict: "ok", reasons: [] });
        expect(result.json.tasks[1]).toMatchObject({ taskId: "idle1", verdict: "not_run" });
        expect(result.json.skipped).toEqual([{ taskId: "nope", reason: "no task with this id" }]);
    });

    test("waits for a running track and reports it once it has finished", async () => {
        const running = makeTrack("run1", "Song", { state: "running" });
        installWorld([running]);
        setTimeout(() => running.updateAttributes({ state: "finished", metadataDiscovered: true }), 700);
        const started = Date.now();
        const result = await callTool("wait_for_tasks", { taskIds: ["run1"], timeoutSec: 10 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(600);
        expect(result.json.done).toBe(true);
        expect(result.json.tasks[0]).toMatchObject({ taskId: "run1", state: "finished" });
    });

    test("gives up at the time limit and lists what is still running, so it can be waited for again", async () => {
        const running = makeTrack("slow1", "Song", { state: "running" });
        installWorld([running]);
        vi.useFakeTimers();
        const pending = callTool("wait_for_tasks", { taskIds: ["slow1"], timeoutSec: 5 });
        await vi.advanceTimersByTimeAsync(6000);
        const result = await pending;
        expect(result.json.done).toBe(false);
        expect(result.json.summary.still_running).toBe(1);
        expect(result.json.tasks[0]).toMatchObject({ taskId: "slow1", running: true });
    });

    test("stops waiting when the user presses Stop", async () => {
        const running = makeTrack("stop1", "Song", { state: "running" });
        installWorld([running]);
        const { AgentTurn } = await import("#base/agent/agentTurn");
        const turn = new AgentTurn();
        const pending = callTool("wait_for_tasks", { taskIds: ["stop1"], timeoutSec: 60 }, turn);
        setTimeout(() => turn.stop(), 300);
        const result = await pending;
        expect(result.json).toMatchObject({ done: false, interrupted: true });
    });

    test("a part that was started counts as running until it ends, even though the task's state does not change", async () => {
        const track = makeTrack("part1", "Song", { state: "finished", metadataDiscovered: true });
        installWorld([track]);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const spy = vi.spyOn(track, "startDownloads").mockReturnValue(gate);
        try {
            const part = track.runDownloadPart();
            expect(track.partRunning).toBe(true);
            const result = callTool("wait_for_tasks", { taskIds: ["part1"], timeoutSec: 10 });
            setTimeout(release, 600);
            await part;
            expect(track.partRunning).toBe(false);
            expect((await result).json.done).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("how a track ended", () => {
    const verdictOf = async (task: ReturnType<typeof makeTrack>) => {
        installWorld([task]);
        return (await callTool("wait_for_tasks", { taskIds: [task.getId()] })).json.tasks[0];
    };

    test("a failed run says so, with the status message", async () => {
        const task = makeTrack("f1", "Song", { state: "failed" });
        const outcome = await verdictOf(task);
        expect(outcome.verdict).toBe("failed");
        expect(outcome.reasons[0]).toMatch(/the run failed/);
    });

    test("no download at all is a failure, and the failed rows say why (the user's name hidden)", async () => {
        const failed: TrackDownloadSource = {
            ...downloadedRow("ytdlp", "x", meta("f2", "Song")),
            state: "failed",
            localFile: undefined,
            fileInfo: undefined,
            progressInfo: { startedAt: 0, log: [`ERROR: HTTP 403 at ${os.homedir()}\\tmp`] },
        };
        const outcome = await verdictOf(downloaded("f2", [failed]));
        expect(outcome.verdict).toBe("failed");
        expect(outcome.reasons).toContain("no source could be downloaded");
        expect(outcome.downloads[0].why[0]).toContain("HTTP 403");
        expect(outcome.downloads[0].why[0]).not.toContain(os.homedir());
    });

    test("a download of another length than the track, or a file that is gone, needs a look", async () => {
        const long = await verdictOf(
            downloaded("n1", [goodRow("n1", 320_000)], { metadataOverride: { duration: 200_000 } })
        );
        expect(long.verdict).toBe("needs_attention");
        expect(long.reasons[0]).toMatch(/320 s but the track should last 200 s/);
        const gone = goodRow("n2");
        gone.localFile = { ...gone.localFile!, state: "missing" } as never;
        const missing = await verdictOf(downloaded("n2", [gone], { metadataOverride: { duration: 200_000 } }));
        expect(missing.reasons).toContain("the downloaded file is missing from the disk");
    });

    test("a title with video-site noise needs a look; a lossy best download is only a note", async () => {
        const lossy = goodRow("n3");
        lossy.fileInfo = { ...lossy.fileInfo!, provenance: "lossy-transcode", codec: "opus" };
        const noisy = downloaded("n3", [lossy], {
            metadataOverride: { trackName: "Song (Official Video)", duration: 200_000 },
        });
        const outcome = await verdictOf(noisy);
        expect(outcome.verdict).toBe("needs_attention");
        expect(outcome.reasons[0]).toMatch(/video-site noise/);
        expect(outcome.notes[0]).toMatch(/lossy-transcode \(opus\)/);
    });
});

describe("review_metadata", () => {
    test("shows each platform's version and flags what looks off before a download", async () => {
        const result = (
            id: string,
            title: string,
            artist: string,
            platform: string,
            primary: boolean,
            duration: number
        ) => ({
            metadata: { ...meta(id, title, artist, platform), duration },
            isPrimaryInput: primary,
            isFavorited: false,
            isRejected: false,
            rank: 0,
            discoverySources: [],
        });
        const upload = makeTrack("rv1", "x", {
            metadataGroups: [
                {
                    platform: "youtube",
                    serviceKey: "youtube",
                    rank: 1,
                    results: [result("yt", "Patrick - Toc toc (Lyrics)", "Moonflower", "youtube", true, 212_000)],
                },
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [result("sp", "Toc toc", "Patrick Sébastien", "spotify", false, 272_000)],
                },
            ],
        });
        const clean = makeTrack("rv2", "Clean", {});
        installWorld([upload, clean]);
        const reviewed = (await callTool("review_metadata", { taskIds: ["rv1", "rv2", "nope"] })).json;
        const [a, b] = reviewed.tracks;
        expect(a.platforms.map((p: { service: string }) => p.service)).toEqual(["youtube", "spotify"]);
        expect(a.flags).toEqual(expect.arrayContaining(["artists_differ", "durations_differ", "no_isrc"]));
        expect(b.flags).toEqual(expect.arrayContaining(["single_platform"]));
        expect(b.flags).not.toContain("artists_differ");
        expect(reviewed.skipped).toEqual([{ taskId: "nope", reason: "no task with this id" }]);
    });

    test("accents and punctuation do not make two spellings of an artist differ", async () => {
        const mk = (id: string, artist: string, platform: string) => ({
            metadata: meta(id, "Song", artist, platform),
            isPrimaryInput: platform === "spotify",
            isFavorited: false,
            isRejected: false,
            rank: 0,
            discoverySources: [],
        });
        const task = makeTrack("rv3", "x", {
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [mk("a", "Patrick Sébastien", "spotify")],
                },
                {
                    platform: "youtube",
                    serviceKey: "youtube",
                    rank: 1,
                    results: [mk("b", "patrick sebastien", "youtube")],
                },
            ],
        });
        installWorld([task]);
        const flags = (await callTool("review_metadata", { taskIds: ["rv3"] })).json.tracks[0].flags;
        expect(flags).not.toContain("artists_differ");
    });
});

describe("get_settings", () => {
    beforeEach(() => installWorld([]));

    test("shows the settings in force, without secrets or the user's folders", async () => {
        SettingsStore.getInstance().patchMusicSettings({
            download: {
                outputDir: path.join(os.homedir(), "Music", "Mine"),
                providers: { probe: { enabled: true, password: "hunter2" } },
            },
        });
        try {
            const all = await callTool("get_settings", {});
            expect(all.json.app.version).toBeTruthy();
            expect(Object.keys(all.json.settings)).toEqual(
                expect.arrayContaining(["download", "metadata", "agent", "general"])
            );
            expect(all.json.settings.ui).toBeUndefined();
            const download = (await callTool("get_settings", { section: "download" })).json.settings.download;
            expect(download.providers.probe).toEqual({ enabled: true, password: "<hidden>" });
            expect(download.outputDir.startsWith("~")).toBe(true);
            expect(download.preferLossless).toBe(true);
            expect(all.text).not.toContain("hunter2");
        } finally {
            SettingsStore.getInstance().patchMusicSettings({ download: { providers: { probe: undefined } } });
        }
    });

    test("an unknown section lists the known ones", async () => {
        const result = await callTool("get_settings", { section: "nope" });
        expect(result.isError).toBe(true);
        expect(result.text).toMatch(/The sections are: general, logs,/);
    });
});

describe("agent.log", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-"));
        file = path.join(dir, "agent.log");
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("one JSON object per line, in order, with the time and everything raw", async () => {
        const log = new AgentLog(
            () => file,
            () => true
        );
        log.write({ kind: "user", text: "hello\nworld" });
        log.write({ kind: "tool-call", tool: "get_task", input: { taskId: "a" } });
        log.write({ kind: "tool-result", output: "x".repeat(20_000) });
        await log.flush();
        const lines = fs
            .readFileSync(file, "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l));
        expect(lines.map((l) => l.kind)).toEqual(["user", "tool-call", "tool-result"]);
        expect(lines[0].text).toBe("hello\nworld");
        expect(lines[1].input).toEqual({ taskId: "a" });
        // Not cut: the log is where the whole of a call is kept.
        expect(lines[2].output).toHaveLength(20_000);
        expect(new Date(lines[0].at).getTime()).toBeGreaterThan(0);
    });

    test("writes nothing when it is switched off", async () => {
        let on = false;
        const log = new AgentLog(
            () => file,
            () => on
        );
        log.write({ kind: "user", text: "private" });
        await log.flush();
        expect(fs.existsSync(file)).toBe(false);
        on = true;
        log.write({ kind: "user", text: "now" });
        await log.flush();
        expect(fs.readFileSync(file, "utf8")).toContain("now");
    });

    test("a big file moves to agent.log.1 and a new one starts", async () => {
        const log = new AgentLog(
            () => file,
            () => true,
            500
        );
        for (let i = 0; i < 10; i++) log.write({ kind: "note", text: `line ${i} ${"x".repeat(80)}` });
        await log.flush();
        expect(fs.existsSync(`${file}.1`)).toBe(true);
        const kept = [file, `${file}.1`].flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n"));
        expect(kept.length).toBeLessThanOrEqual(10);
        expect(fs.statSync(file).size).toBeLessThan(1000);
    });

    test("a write that cannot be done never throws", async () => {
        const log = new AgentLog(
            () => path.join(dir, "no\0such", "agent.log"),
            () => true
        );
        log.write({ kind: "note", text: "lost" });
        await expect(log.flush()).resolves.toBeUndefined();
    });
});

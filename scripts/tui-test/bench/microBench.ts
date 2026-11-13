/**
 * Micro-benchmarks of the hot paths that no screen scenario isolates well (the file-system and serialisation
 * costs behind `AUDIT-performance.md`). Each one calls only the public API of the module, so the same file
 * measures the code before and after a fix.
 *
 *   yarn tsx scripts/tui-test/bench/microBench.ts            # pretty table
 *   yarn tsx scripts/tui-test/bench/microBench.ts --json     # one JSON array (used by perfSuite.ts)
 *
 * Every result is the median of RUNS runs. `cpuMs` is process CPU time (user + system), `lagMaxMs` the longest
 * event-loop block seen while the work ran: the number a user feels as a freeze.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { scaleSessionsFile } from "../scaleFixture.ts";

// The app reads GOBLIN_DATA_DIR at import time: keep every benchmark out of a real data folder.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-bench-"));
process.env["GOBLIN_DATA_DIR"] = workDir;
process.env["GOBLIN_NO_AUDIO"] = "1";

const RUNS = 5;
const json = process.argv.includes("--json");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface BenchResult {
    name: string;
    description: string;
    /** Wall-clock ms of the measured work. */
    ms: number;
    /** Process CPU ms (user + system) over the same work. */
    cpuMs: number;
    /** Longest event-loop block while it ran, in ms. */
    lagMaxMs: number;
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (n: number): number => Math.round(n * 100) / 100;

async function measure(
    name: string,
    description: string,
    work: () => Promise<void> | void,
    setup?: () => Promise<void> | void
): Promise<BenchResult> {
    const ms: number[] = [];
    const cpu: number[] = [];
    const lag: number[] = [];
    for (let run = 0; run < RUNS; run++) {
        await setup?.();
        const histogram = monitorEventLoopDelay({ resolution: 1 });
        histogram.enable();
        const cpuStart = process.cpuUsage();
        const start = performance.now();
        await work();
        ms.push(performance.now() - start);
        const used = process.cpuUsage(cpuStart);
        cpu.push((used.user + used.system) / 1000);
        histogram.disable();
        lag.push(histogram.count === 0 ? 0 : Math.max(0, histogram.max / 1e6 - 1));
    }
    return {
        name,
        description,
        ms: round(median(ms)),
        cpuMs: round(median(cpu)),
        lagMaxMs: round(median(lag)),
    };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── sessions: saving and loading a big file (PERF-02) ─────────────────────────────────────────────────────────

function makeBigSessionsFile(file: string): void {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, "scripts/tui-test/fixtures/50-tasks-with-metadata/sessions.json"), file);
    scaleSessionsFile(dir, { tasks: 300, otherSessions: 19, otherSessionTasks: 300, archived: 300 });
}

async function benchSessions(): Promise<BenchResult[]> {
    const { SessionStore } = await import("#sessions/sessionStore");
    const bigFile = path.join(workDir, "sessions-bench", "sessions.json");
    makeBigSessionsFile(bigFile);
    const sizeMb = round(fs.statSync(bigFile).size / 1048576);

    const results: BenchResult[] = [];

    results.push(
        await measure(
            "sessions.load",
            `parse a ${sizeMb} MB sessions.json (20 sessions x 300 tasks + 300 archived)`,
            () => {
                new SessionStore(bigFile).getAll();
            }
        )
    );

    // The save pattern of a run: the open session is saved again and again while 19 others sit untouched.
    let store: InstanceType<typeof SessionStore>;
    const reopen = (): void => {
        store = new SessionStore(bigFile);
        store.getAll(); // loading is measured above
    };

    results.push(
        await measure(
            "sessions.save x10",
            `10 saves of the open session in a ${sizeMb} MB file, 50 ms apart, until written`,
            async () => {
                for (let i = 0; i < 10; i++) {
                    const current = store.getAll()[0]!;
                    store.upsertSession({ ...current, updatedAt: new Date(Date.now() + i).toISOString() });
                    await sleep(50);
                }
                await store.flush();
            },
            reopen
        )
    );

    // Same, once the app has saved the file at least once (the first save of a loaded file serialises everything).
    results.push(
        await measure(
            "sessions.save warm x10",
            `10 saves of the open session in a ${sizeMb} MB file once it was written once before`,
            async () => {
                for (let i = 0; i < 10; i++) {
                    const current = store.getAll()[0]!;
                    store.upsertSession({ ...current, updatedAt: new Date(Date.now() + i).toISOString() });
                    await sleep(50);
                }
                await store.flush();
            },
            async () => {
                reopen();
                store.upsertSession({ ...store.getAll()[0]! });
                await store.flush();
            }
        )
    );

    results.push(
        await measure(
            "sessions.setLast x10",
            "10 saves that change nothing but lastSessionId (what every persist does after the first)",
            async () => {
                for (let i = 0; i < 10; i++) {
                    store.setLastSessionId(store.getAll()[0]!.id);
                    await sleep(50);
                }
                await store.flush();
            },
            reopen
        )
    );
    return results;
}

// ── temp folder listing (PERF-08) ─────────────────────────────────────────────────────────────────────────────

async function benchTempFiles(): Promise<BenchResult[]> {
    const { findExistingTempFile, listTempFilesWithStem } = await import("#flows/musicDownloadFlow/utils/tempFile");
    const dir = path.join(workDir, "temp-bench");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 3000; i++) {
        const uuid = `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
        fs.writeFileSync(path.join(dir, `YouTube spotify-track-${i} ${uuid}.opus`), "");
    }
    const metadata = { uri: "spotify::track::missing", trackName: "x", artists: [{ name: "y" }] } as never;
    const stem = "YouTube spotify-track-1 00000000-0000-4000-8000-000000000001";

    return [
        await measure(
            "temp.findExisting x40",
            "40 look-ups of a finished temp file in a folder of 3,000 files",
            async () => {
                // `await` also covers a fix that makes these asynchronous.
                for (let i = 0; i < 40; i++) await findExistingTempFile("YouTube", metadata, ["opus", "m4a"], dir);
            }
        ),
        await measure("temp.listStem x40", "40 listings of the files sharing one stem, same folder", async () => {
            for (let i = 0; i < 40; i++) await listTempFilesWithStem(dir, stem);
        }),
    ];
}

// ── log ring buffer (audit section 4) ─────────────────────────────────────────────────────────────────────────

async function benchLogRing(): Promise<BenchResult[]> {
    const { InkTransport } = await import("#base/logger/ink-transport");
    return [
        await measure("log.ring 50k", "50,000 log lines pushed into a full 2,000-entry history", async () => {
            const transport = new InkTransport({ maxLogs: 2000 });
            for (let i = 0; i < 50_000; i++) {
                transport.log(
                    { level: "debug", message: "yt-dlp: [download]  12.3% of 4.50MiB at 1.20MiB/s" } as never,
                    () => {}
                );
            }
            await sleep(0);
        }),
    ];
}

const all: BenchResult[] = [];
for (const group of [benchSessions, benchTempFiles, benchLogRing]) {
    try {
        all.push(...(await group()));
    } catch (error) {
        process.stderr.write(
            `bench group ${group.name} failed: ${error instanceof Error ? error.stack : String(error)}\n`
        );
    }
}

fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

if (json) {
    process.stdout.write(JSON.stringify(all) + "\n");
} else {
    process.stdout.write(
        `${"benchmark".padEnd(24)}${"ms".padStart(10)}${"cpu ms".padStart(10)}${"block ms".padStart(10)}  what\n`
    );
    for (const r of all) {
        process.stdout.write(
            `${r.name.padEnd(24)}${String(r.ms).padStart(10)}${String(r.cpuMs).padStart(10)}${String(r.lagMaxMs).padStart(10)}  ${r.description}\n`
        );
    }
}
process.exit(0);

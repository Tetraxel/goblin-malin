// Durable, append-only JSONL writer for profiling records.
//
// Writes are synchronous (`fs.writeSync`) so records survive the harness
// hard-killing the PTY process — a buffered stream would lose its tail.
// The cost lands *after* each commit's React work is measured, so it does not
// pollute the per-component timings we care about.

import fs from "node:fs";
import type { ProfileRecord } from "./types";

let fd: number | undefined;
let seq = 0;

/** Open the output file named by GOBLIN_PROFILE_OUT. No-op if unset. */
export function initRecorder(): void {
    const out = process.env["GOBLIN_PROFILE_OUT"];
    if (!out) return;
    try {
        fd = fs.openSync(out, "a");
    } catch {
        fd = undefined;
    }
}

export function isRecording(): boolean {
    return fd !== undefined;
}

export function nextSeq(): number {
    return seq++;
}

export function record(rec: ProfileRecord): void {
    if (fd === undefined) return;
    try {
        fs.writeSync(fd, JSON.stringify(rec) + "\n");
    } catch {
        /* a single dropped record must never crash the app */
    }
}

/** Round to 3 decimals (microsecond resolution) to keep the JSONL compact. */
export function round(ms: number): number {
    return Math.round(ms * 1000) / 1000;
}

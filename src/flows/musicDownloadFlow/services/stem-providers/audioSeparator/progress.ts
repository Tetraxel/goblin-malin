import { type StemProgress } from "../../../stems/stemService";

/**
 * Reading what audio-separator writes on stderr (P33 spike, 0.48.0). Its progress bars (tqdm) end with `\r`, not a
 * line break, so the caller splits on both. Three kinds of bar:
 *
 *     " 54%|#####4    | 45.6M/84.1M [00:00<00:00, 54.1MiB/s]"   a model file being downloaded (bytes)
 *     " 67%|######6   | 24/36 [00:02<00:01,  9.88it/s]"          one separation pass (a model makes several)
 *     "28.3kiB [00:00, 28.2MiB/s]"                               a download of unknown size (no percentage)
 *
 * and log lines: "2026-11-23 02:59:44.568 - INFO - separator - Loading model htdemucs_ft.yaml...".
 */
export type SeparatorLine =
    | { kind: "download"; fraction: number }
    | { kind: "pass"; fraction: number }
    | { kind: "log"; level: string; message: string }
    | { kind: "exception"; message: string };

const BAR = /^\s*(\d{1,3})%\|[^|]*\|\s*[\d.]+\w*\/[\d.]+\w*\s*\[[^\]]*?,\s*(\S+)\]\s*$/;
const LOG = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d[.,]\d+ - (DEBUG|INFO|WARNING|ERROR|CRITICAL) - [\w.]+ - (.*)$/;
const EXCEPTION = /^(?:[\w.]+\.)?(\w*(?:Error|Exception)): (.+)$/;

export function parseSeparatorLine(line: string): SeparatorLine | null {
    const bar = BAR.exec(line);
    if (bar) {
        const fraction = Math.min(1, Number(bar[1]) / 100);
        // The rate's unit tells a download (`54.1MiB/s`, `?iB/s`) from a pass (`9.88it/s`, `1.20s/it`).
        return /B\/s$/.test(bar[2]) ? { kind: "download", fraction } : { kind: "pass", fraction };
    }
    const log = LOG.exec(line);
    if (log) return { kind: "log", level: log[1], message: log[2].trim() };
    const exception = EXCEPTION.exec(line.trim());
    if (exception) return { kind: "exception", message: `${exception[1]}: ${exception[2]}` };
    return null;
}

/**
 * Turns the lines of one separation into what the user sees: the step and how far it is. A model makes several
 * passes (htdemucs_ft: one per sub-model and shift), each a bar from 0 to 100 %: they are counted, since nothing says
 * how many there will be. Also keeps the last error the program wrote, for the message of a failed run.
 */
export class SeparatorProgress {
    private passes = 0;
    private passOpen = false;
    private lastError?: string;

    /** The progress this line brings, or `undefined` when it changes nothing the user sees. */
    feed(line: string): StemProgress | undefined {
        const parsed = parseSeparatorLine(line);
        if (!parsed) return undefined;
        switch (parsed.kind) {
            case "download":
                return { text: "Downloading the model", fraction: parsed.fraction };
            case "pass": {
                if (!this.passOpen) {
                    this.passes++;
                    this.passOpen = true;
                }
                if (parsed.fraction >= 1) this.passOpen = false;
                return { text: `Separating · pass ${this.passes}`, fraction: parsed.fraction };
            }
            case "exception":
                this.lastError = parsed.message;
                return undefined;
            case "log":
                if (parsed.level === "ERROR" || parsed.level === "CRITICAL") {
                    this.lastError = parsed.message;
                    return undefined;
                }
                if (parsed.message.startsWith("Loading model")) return { text: "Loading the model" };
                if (parsed.message.startsWith("Starting separation")) return { text: "Separating", fraction: 0 };
                if (parsed.message.startsWith("Writing output")) return { text: "Writing the stems" };
                return undefined;
        }
    }

    /** The last error the program wrote, if any. */
    error(): string | undefined {
        return this.lastError;
    }
}

/** What uv says while it installs ("Resolved 80 packages in 1.2s", "Downloading torch (2.3GiB)"…), or `null`. */
export function parseUvLine(line: string): StemProgress | null {
    const text = line.trim();
    if (/^(Resolved|Downloading|Downloaded|Prepared|Installed|Installing|Uninstalled|Removed)\b/.test(text)) {
        return { text };
    }
    return null;
}

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, kB: 1e3, MB: 1e6, GB: 1e9 };

/** "2.0GiB" → bytes; `undefined` for anything else. */
export function parseUvSize(text: string): number | undefined {
    const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)$/.exec(text.trim());
    return match ? Number(match[1]) * UNITS[match[2]] : undefined;
}

function formatGB(bytes: number): string {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * The progress of `uv tool install`, read from its lines. Through a pipe uv draws no bars, but it announces every
 * download with its size first ("Downloading torch (2.0GiB)", P33: 16 of them, 2.29 GB for the CUDA build), then says
 * "Downloaded torch" when one is done. The bytes of finished downloads are exact; the one still going (torch takes
 * most of the time) is estimated from the speed the finished ones reached, never past 95 % of it: the text says
 * "about" while it is an estimate. Counting the files uv unpacks on disk would be exact but takes seconds a look
 * (11 000 files). Then come "Prepared" (all downloaded) and "Installed" (linked into the environment).
 *
 * The download part is 0–90 % of the bar, installing 90–98 %; cleaning uv's cache after it is the last step.
 */
export class UvInstallProgress {
    private announced = new Map<string, number>();
    private done = new Set<string>();
    private firstDownloadAt?: number;
    private lastDoneAt?: number;
    private phase: "starting" | "downloading" | "installing" | "installed" = "starting";

    /** Reads one line of uv's output. */
    feed(line: string, now: number): void {
        const text = line.trim();
        const downloading = /^Downloading (.+?) \(([^)]+)\)$/.exec(text);
        if (downloading) {
            const size = parseUvSize(downloading[2]);
            if (size !== undefined) this.announced.set(downloading[1], size);
            this.firstDownloadAt ??= now;
            this.phase = "downloading";
            return;
        }
        const downloaded = /^Downloaded (.+)$/.exec(text);
        if (downloaded) {
            // Python itself is announced and downloaded before the packages: it counts like one.
            this.done.add(downloaded[1]);
            this.lastDoneAt = now;
            return;
        }
        if (/^Prepared \d+ packages?/.test(text)) this.phase = "installing";
        else if (/^Installed \d+ packages?/.test(text)) this.phase = "installed";
    }

    /** What to show now (the estimate moves with time, so it is asked again even when uv says nothing). */
    snapshot(now: number): StemProgress {
        if (this.phase === "installing") return { text: "Installing the packages", fraction: 0.9 };
        if (this.phase === "installed") return { text: "Installed", fraction: 0.98 };
        if (this.phase === "starting" || this.announced.size === 0) return { text: "Resolving the packages" };

        let total = 0;
        let finished = 0;
        let pending = 0;
        let largestPending: [string, number] | undefined;
        for (const [name, size] of this.announced) {
            total += size;
            if (this.done.has(name)) finished += size;
            else {
                pending += size;
                if (!largestPending || size > largestPending[1]) largestPending = [name, size];
            }
        }
        // The speed: what had finished when the last package finished, over the time it took. The packages download
        // side by side, so this is a floor of the real speed. Projected to now, between what is sure (`finished`) and
        // 95 % of what is still coming.
        const start = this.firstDownloadAt ?? now;
        const speed = this.lastDoneAt && this.lastDoneAt > start ? finished / (this.lastDoneAt - start) : 0;
        const received = Math.min(Math.max(finished, speed * (now - start)), finished + pending * 0.95);
        const isEstimate = received > finished;
        const count = `${this.done.size} of ${this.announced.size} packages`;
        const bytes = `${isEstimate ? "about " : ""}${formatGB(received)} of ${formatGB(total)}`;
        const waiting = largestPending ? ` · ${largestPending[0]} (${formatGB(largestPending[1])})` : "";
        return {
            text: `Downloading ${count} · ${bytes}${waiting}`,
            fraction: total > 0 ? (received / total) * 0.9 : undefined,
        };
    }
}

/** The stem a separated file holds, from audio-separator's own name (`<input>_(Vocals)_<model>.flac`), lower case. */
export function stemFromOutputName(fileName: string): string | null {
    const match = /_\(([^()]+)\)_[^()]*\.[A-Za-z0-9]+$/.exec(fileName);
    return match ? match[1].trim().toLowerCase() : null;
}

import { StatusType } from "#base/task/task-status";
import { type DownloadTask } from "../utils/downloadTask";
import { computeCompiledMetadata, type CompiledMetadata } from "../utils/compiledMetadata";
import { type TrackDownloadSource, type TrackDownloadTask } from "../types";
import { getMusicSettings } from "../settings";
import { isTaskRunning } from "./taskAccess";
import { TITLE_NOISE_PATTERN, safeText } from "./views";

/**
 * What happened to a task, worked out by the app and not by a model: whether a run is still going, how it ended, and
 * what deserves a second look. Claude reads this instead of piecing it together from the raw task, and cannot
 * mistake "still working" for "done".
 */

/** The duration of two versions of a track may differ by this much before it is worth a look. */
const DURATION_TOLERANCE_MS = 10_000;
const MAX_ROWS = 8;
const clip = (text: string, max = 160): string => (text.length > max ? `${text.slice(0, max)}…` : text);

const attrsOf = (task: DownloadTask): TrackDownloadTask | undefined => task.getAttributes();

/** Whether something is still running or queued for this track: a run, a part of one, or a download row. */
export function isTaskBusy(task: DownloadTask): boolean {
    const a = attrsOf(task);
    if (!a) return false;
    if (isTaskRunning(task)) return true;
    if (a.primaryMetadataInProgress || a.metadataDiscoveringInProgress) return true;
    if (a.downloadSources.some((s) => s.state === "searching" || s.state === "downloading")) return true;
    // Queued by the run controller: pending, with the "Queued" status it sets.
    return a.state === "pending" && task.getStatus().get().type === StatusType.Pending;
}

const compiledOf = (a: TrackDownloadTask): CompiledMetadata =>
    computeCompiledMetadata(a.metadataGroups ?? [], a.metadataOverride ?? {});

function downloadRow(source: TrackDownloadSource) {
    const log = source.progressInfo?.log;
    return {
        provider: source.provider,
        state: source.state,
        selected: source.selected || undefined,
        hasFile: source.localFile?.state === "found",
        format: source.fileInfo?.format,
        provenance: source.fileInfo?.provenance,
        bitrateKbps: source.fileInfo?.bitrateKbps,
        durationMs: source.fileInfo?.durationMs,
        // Why a row failed: the service's last words, with the user's name and folders hidden.
        ...(source.state === "failed" && log?.length ? { why: log.slice(-2).map((l) => safeText(l, 160) ?? "") } : {}),
    };
}

export type Verdict = "ok" | "failed" | "needs_attention" | "stopped" | "not_run";

export type TaskOutcome = {
    taskId: string;
    title: string;
    state: string | undefined;
    status: { type: string; message: string };
    verdict: Verdict;
    /** Why, one line each: what failed, or what to look at. Empty for "ok". */
    reasons: string[];
    /** Facts that are not a problem but that Claude may want to mention ("the best download is lossy"). */
    notes: string[];
    downloads: ReturnType<typeof downloadRow>[];
    musicBrainz?: string;
};

/** The first row Claude should look at: the selected download, else the first one that downloaded. */
function bestDownload(a: TrackDownloadTask): TrackDownloadSource | undefined {
    const usable = a.downloadSources.filter((s) => s.state === "downloaded" && !s.isRejected);
    return usable.find((s) => s.selected) ?? usable[0];
}

/** How a task ended, for a task nothing is running on. */
export function assessTask(task: DownloadTask): TaskOutcome {
    const a = attrsOf(task);
    const status = task.getStatus().get();
    const base = {
        taskId: task.getId(),
        state: a?.state,
        status: { type: String(status.type), message: safeText(status.message, 160) ?? "" },
        notes: [] as string[],
    };
    if (!a) return { ...base, title: "", verdict: "not_run", reasons: ["the task has no data"], downloads: [] };

    const compiled = compiledOf(a);
    const reasons: string[] = [];
    const notes = base.notes;
    let verdict: Verdict = "ok";
    const worse = (v: Verdict) => {
        const rank: Record<Verdict, number> = { ok: 0, not_run: 1, stopped: 2, needs_attention: 3, failed: 4 };
        if (rank[v] > rank[verdict]) verdict = v;
    };

    const ranAnything = a.primaryMetadataFetched || a.metadataDiscovered || a.downloadsFetched;
    if (a.state === "failed") {
        worse("failed");
        reasons.push(`the run failed: ${base.status.message || "no message"}`);
    } else if (a.state === "stopped") {
        worse("stopped");
        reasons.push("the run was stopped");
    } else if (!ranAnything) {
        worse("not_run");
        reasons.push("nothing has run on this task yet");
    }

    if (a.primaryMetadataFetched || a.metadataDiscovered) {
        if (compiled.trackName === "") {
            worse("failed");
            reasons.push("no metadata was found (no title)");
        } else if (TITLE_NOISE_PATTERN.test(compiled.trackName)) {
            worse("needs_attention");
            reasons.push("the title has video-site noise, like (Official Video)");
        }
        if (a.musicBrainzIdentity?.verdict === "needsReview") {
            worse("needs_attention");
            reasons.push("MusicBrainz asks the user to check which release this is");
        }
    }

    if (a.downloadsFetched) {
        const downloaded = a.downloadSources.filter((s) => s.state === "downloaded" && !s.isRejected);
        if (downloaded.length === 0) {
            worse("failed");
            reasons.push("no source could be downloaded");
        } else {
            const best = bestDownload(a);
            if (best && best.localFile?.state !== "found") {
                worse("needs_attention");
                reasons.push("the downloaded file is missing from the disk");
            }
            const got = best?.fileInfo?.durationMs;
            if (got && compiled.duration && Math.abs(got - compiled.duration) > DURATION_TOLERANCE_MS) {
                worse("needs_attention");
                reasons.push(
                    `the download lasts ${Math.round(got / 1000)} s but the track should last ${Math.round(compiled.duration / 1000)} s: it may be another version`
                );
            }
            if (best?.fileInfo?.provenance && best.fileInfo.provenance !== "lossless") {
                const lossless = getMusicSettings().download.preferLossless;
                notes.push(
                    `the best download is ${best.fileInfo.provenance}${best.fileInfo.codec ? ` (${best.fileInfo.codec})` : ""}${lossless ? ", and lossless is preferred, but none was found" : ""}`
                );
            }
        }
    }

    // The rows that tell the most first: the one in use, then the others that downloaded, then the failures.
    const rank = (s: TrackDownloadSource) =>
        s.selected ? 0 : s.state === "downloaded" ? 1 : s.state === "failed" ? 2 : 3;
    const downloads = [...a.downloadSources]
        .sort((x, y) => rank(x) - rank(y))
        .slice(0, MAX_ROWS)
        .map(downloadRow);

    return {
        ...base,
        title: compiled.trackName,
        verdict,
        reasons,
        notes,
        downloads,
        ...(a.musicBrainzIdentity ? { musicBrainz: a.musicBrainzIdentity.verdict } : {}),
    };
}

// ── Review before a download ─────────────────────────────────────────────────

const norm = (s: string): string =>
    s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

export type MetadataReview = {
    taskId: string;
    title: string;
    artists: string[];
    album?: string;
    year?: number;
    isrc?: string;
    durationMs?: number;
    /** Which platform each compiled field came from ("manual" is the user's or Claude's override). */
    from: CompiledMetadata["attribution"];
    platforms: { service: string; title: string; artists: string[]; durationMs?: number; primary?: boolean }[];
    musicBrainz?: string;
    /** What looks off, one short code each; empty when nothing does. */
    flags: string[];
};

/**
 * A track's compiled metadata next to what each platform said, with flags for what is worth a look before it is
 * downloaded: a title with noise, platforms that disagree on the artist or the length, missing fields.
 */
export function reviewTask(task: DownloadTask): MetadataReview {
    const a = attrsOf(task)!;
    const compiled = compiledOf(a);
    const results = a.metadataGroups.flatMap((g) =>
        g.results.filter((r) => !r.isRejected).map((r) => ({ service: g.serviceKey, r }))
    );
    const platforms = results.slice(0, 8).map(({ service, r }) => ({
        service,
        title: clip(r.metadata.trackName, 120),
        artists: r.metadata.artists.map((x) => clip(x.name, 80)),
        durationMs: r.metadata.duration,
        ...(r.isPrimaryInput ? { primary: true } : {}),
    }));

    const flags: string[] = [];
    if (compiled.trackName === "") flags.push("no_title");
    else if (TITLE_NOISE_PATTERN.test(compiled.trackName)) flags.push("title_noise");
    if (compiled.artists.length === 0) flags.push("no_artist");
    if (!compiled.isrc) flags.push("no_isrc");
    if (!compiled.album) flags.push("no_album");
    if (!compiled.year) flags.push("no_year");

    // Do the platforms agree on who made it? A video upload's "artist" is often the uploader's channel.
    const firstArtists = new Set(
        results
            .map(({ r }) => r.metadata.artists[0]?.name)
            .filter((n): n is string => !!n)
            .map(norm)
            .filter(Boolean)
    );
    if (firstArtists.size > 1) flags.push("artists_differ");
    const durations = results.map(({ r }) => r.metadata.duration).filter((d): d is number => !!d);
    if (durations.length > 1 && Math.max(...durations) - Math.min(...durations) > DURATION_TOLERANCE_MS) {
        flags.push("durations_differ");
    }
    if (results.length <= 1) flags.push("single_platform");
    if (a.musicBrainzIdentity?.verdict === "needsReview") flags.push("musicbrainz_needs_review");

    return {
        taskId: task.getId(),
        title: compiled.trackName,
        artists: compiled.artists.map((x) => x.name),
        album: compiled.album?.albumName,
        year: compiled.year,
        isrc: compiled.isrc,
        durationMs: compiled.duration,
        from: compiled.attribution,
        platforms,
        ...(a.musicBrainzIdentity ? { musicBrainz: a.musicBrainzIdentity.verdict } : {}),
        flags,
    };
}

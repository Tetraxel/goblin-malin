import { localFilePaths } from "./missingLocalFiles";
import { TempGroup, tempFileStem } from "./tempDownloads";

/**
 * Which temporary downloads are safe to delete.
 *
 * A temp file is "in use" while a session that points at it was used recently — opened, edited or still open —
 * not while the file itself is new: a session created two months ago but opened yesterday keeps its files.
 * What counts as the last use of a session lives in `StoredSession.lastUsedAt` (see sessions/types.ts).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type TempAge = {
    /** Stable id, stored in settings. */
    key: string;
    label: string;
    /** Files not used for at least this long may go. 0 = no age limit at all (everything). */
    ms: number;
};

/** The ages offered when cleaning, least to most forgiving after "Everything". */
export const TEMP_AGES: readonly TempAge[] = [
    { key: "all", label: "Everything", ms: 0 },
    { key: "12h", label: "12 hours", ms: 12 * HOUR_MS },
    { key: "1d", label: "1 day", ms: DAY_MS },
    { key: "3d", label: "3 days", ms: 3 * DAY_MS },
    { key: "7d", label: "7 days", ms: 7 * DAY_MS },
    { key: "14d", label: "14 days", ms: 14 * DAY_MS },
    { key: "1mo", label: "1 month", ms: 30 * DAY_MS },
    { key: "2mo", label: "2 months", ms: 60 * DAY_MS },
    { key: "6mo", label: "6 months", ms: 180 * DAY_MS },
];

export const DEFAULT_TEMP_AGE_KEY = "7d";
/** The reminder only speaks up when something has been unused for at least this long. */
export const REMINDER_MIN_AGE = TEMP_AGES.find((a) => a.key === "7d")!;
/** What "delete temporary downloads automatically" removes. */
export const AUTO_CLEAN_AGE: TempAge = { key: "48h", label: "48 hours", ms: 48 * HOUR_MS };
/** Don't remind again for this long after the reminder was shown. */
export const REMINDER_INTERVAL_MS = DAY_MS;
/**
 * A file written to this recently is left alone whatever the age chosen: a download may be writing it right
 * now, and a session may not have recorded it yet (sessions are saved a moment after a change).
 */
export const ACTIVE_FILE_GUARD_MS = 2 * 60 * 1000;

export function findTempAge(key: string | undefined): TempAge {
    return TEMP_AGES.find((a) => a.key === key) ?? TEMP_AGES.find((a) => a.key === DEFAULT_TEMP_AGE_KEY)!;
}

/** What references temp files: the snapshots of one session (or of the live queue). */
export type TempUseGroup = {
    /** When this session was last used (ms since epoch). */
    lastUsedMs: number;
    /** The session open right now (or the live queue): never cleaned under the user, whatever its age. */
    live: boolean;
    snapshots: { attributes?: unknown }[];
};

export type TempUse = { lastUsedMs: number; live: boolean };
/** Stem → the most recent use of any session that points at it. */
export type TempUseIndex = Map<string, TempUse>;

export function buildTempUseIndex(groups: TempUseGroup[]): TempUseIndex {
    const index: TempUseIndex = new Map();
    for (const group of groups) {
        for (const snapshot of group.snapshots) {
            for (const filePath of localFilePaths(snapshot.attributes)) {
                const stem = tempFileStem(filePath);
                if (!stem) continue; // not one of ours (e.g. a file the user relocated the source to)
                const known = index.get(stem);
                index.set(stem, {
                    lastUsedMs: Math.max(known?.lastUsedMs ?? 0, group.lastUsedMs),
                    live: (known?.live ?? false) || group.live,
                });
            }
        }
    }
    return index;
}

/** When a group of temp files was last of any use: the latest of its newest session use and its own write time. */
export function lastUseOf(group: TempGroup, index: TempUseIndex): number {
    return Math.max(index.get(group.stem)?.lastUsedMs ?? 0, group.mtimeMs);
}

/**
 * The groups that may be deleted for `age`: not written in the last few minutes, not in the session open
 * right now (unless `age` is "Everything"), and unused for at least `age.ms`.
 */
export function selectTempGroups(
    groups: TempGroup[],
    index: TempUseIndex,
    age: TempAge,
    now: number = Date.now()
): TempGroup[] {
    return groups.filter((group) => {
        if (now - group.mtimeMs < ACTIVE_FILE_GUARD_MS) return false;
        if (age.ms === 0) return true;
        if (index.get(group.stem)?.live) return false;
        return now - lastUseOf(group, index) >= age.ms;
    });
}

export type TempAgeSummary = {
    age: TempAge;
    files: number;
    bytes: number;
    /** How many of those files belong to the session open right now (only "Everything" can include any). */
    liveFiles: number;
};

export function sumGroups(groups: TempGroup[]): { files: number; bytes: number } {
    return groups.reduce(
        (sum, g) => ({ files: sum.files + g.files.length, bytes: sum.bytes + g.bytes }),
        { files: 0, bytes: 0 }
    );
}

/** For every offered age, how much would go — so the dialog can show it while the user flips through them. */
export function summarizeByAge(groups: TempGroup[], index: TempUseIndex, now: number = Date.now()): TempAgeSummary[] {
    return TEMP_AGES.map((age) => {
        const selected = selectTempGroups(groups, index, age, now);
        const liveFiles = sumGroups(selected.filter((g) => index.get(g.stem)?.live)).files;
        return { age, ...sumGroups(selected), liveFiles };
    });
}

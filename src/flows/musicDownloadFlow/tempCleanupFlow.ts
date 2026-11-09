import os from "os";
import path from "path";
import { globalLogger } from "#base/logger/logger";
import { tempCleanupBridge, TempCleanupOption } from "#base/bridges/tempCleanupBridge";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { getBinDir } from "#utils/appPaths";
import { formatSize } from "#utils/formatBytes";
import { SessionManager } from "#sessions/sessionManager";
import { SettingsStore } from "#settings/settingsStore";
import { getMusicSettings } from "./settings";
import { getTempDownloadDir } from "./saveSettings";
import { ProtectedPath, TempGroup, checkTempFolder, deleteTempGroups, scanTempGroups } from "./utils/tempDownloads";
import {
    AUTO_CLEAN_AGE,
    REMINDER_INTERVAL_MS,
    REMINDER_MIN_AGE,
    TempAge,
    TempUseIndex,
    buildTempUseIndex,
    findTempAge,
    selectTempGroups,
    sumGroups,
    summarizeByAge,
} from "./utils/tempCleanup";

/**
 * Cleaning the temporary-downloads folder: the manual action in Settings, the start-up reminder and the
 * optional automatic clean-up all go through here.
 *
 * Three rules hold everywhere:
 *  - Only the app's own temp files are ever deleted, and never from a folder that holds the music library
 *    (see `checkTempFolder`).
 *  - A file a session used recently is kept (see `selectTempGroups`).
 *  - While files are deleted and sessions rewritten, the whole UI is blocked behind a progress box, and every
 *    source that pointed at a deleted file is marked "File not found" before the user can touch anything again.
 */

const logger = globalLogger.createChild({ service: "TempCleanup" });

export type TempCleanupOutcome = "cleaned" | "nothing" | "declined" | "silenced" | "refused" | "failed" | "skipped";

const CLEANING_TITLE = "Cleaning temporary downloads";

/** Folders the temporary folder must never be, or contain. */
function protectedPaths(): ProtectedPath[] {
    return [
        { label: "output folder", path: getMusicSettings().download.outputDir },
        { label: "home folder", path: os.homedir() },
        { label: "app data folder", path: DEFAULT_APP_DATA_DIR },
        { label: "app data folder", path: path.dirname(getBinDir()) },
        { label: "current working directory", path: process.cwd() },
    ];
}

type Inspection =
    { ok: true; dir: string; groups: TempGroup[]; index: TempUseIndex } | { ok: false; dir: string; reason: string };

/** The folder's temp files and who uses them, as they are right now. */
async function inspect(dir: string = getTempDownloadDir()): Promise<Inspection> {
    const check = checkTempFolder(dir, protectedPaths());
    if (!check.ok) return check;
    const groups = await scanTempGroups(check.dir);
    const index = buildTempUseIndex(SessionManager.getInstance().getTempUseGroups());
    return { ok: true, dir: check.dir, groups, index };
}

function patchDownloadSettings(patch: Record<string, string | boolean>): void {
    SettingsStore.getInstance().patchMusicSettings({ download: patch });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

type CleanResult = {
    files: number;
    bytes: number;
    failed: number;
    /** Deleted downloads that sessions pointed at: those sources now say "File not found". */
    usedBySessions: number;
};

/**
 * Deletes what `age` allows from an inspection, then marks the sources that pointed at it. Blocks the UI
 * (a progress box) from start to end; the caller releases it.
 */
async function deleteForAge(found: Extract<Inspection, { ok: true }>, age: TempAge): Promise<CleanResult> {
    const doomed = selectTempGroups(found.groups, found.index, age);
    if (doomed.length === 0) return { files: 0, bytes: 0, failed: 0, usedBySessions: 0 };

    tempCleanupBridge.working(CLEANING_TITLE, `Deleting ${plural(sumGroups(doomed).files, "file")}…`);
    const result = await deleteTempGroups(doomed, (done, total) =>
        tempCleanupBridge.working(CLEANING_TITLE, `Deleting… ${done} / ${total}`)
    );

    tempCleanupBridge.working(CLEANING_TITLE, "Updating your sessions…");
    // Every download the clean-up went through, not only those fully removed: a source whose main file went
    // while a locked leftover stayed behind is just as gone.
    await SessionManager.getInstance().markTempFilesDeleted(new Set(doomed.map((group) => group.stem)));

    const usedBySessions = [...result.removedStems].filter((stem) => found.index.has(stem)).length;
    logger.info(
        `Temporary downloads cleaned (${age.label}): ${result.removedFiles} file(s), ${formatSize(result.bytes)}` +
            (result.failedFiles > 0 ? `, ${result.failedFiles} could not be deleted` : "") +
            `, ${usedBySessions} used by a session`
    );
    return { files: result.removedFiles, bytes: result.bytes, failed: result.failedFiles, usedBySessions };
}

function resultLines(result: CleanResult): string[] {
    const lines = [`Deleted ${plural(result.files, "file")} (${formatSize(result.bytes)}).`];
    if (result.usedBySessions > 0) {
        lines.push(
            `${plural(result.usedBySessions, "download")} used by your sessions ${result.usedBySessions === 1 ? "is" : "are"} gone: those sources now show “File not found” until they are downloaded again. Saved files are untouched.`
        );
    }
    if (result.failed > 0) {
        lines.push(`${plural(result.failed, "file")} could not be deleted (is another program using them?).`);
    }
    return lines;
}

let running = false;

/**
 * Asks how far back to clean, then cleans. `manual` is the Settings action; `reminder` is the start-up
 * suggestion, which says nothing at all when there is nothing old enough to be worth mentioning. `dir` is the
 * folder to clean when it is not the saved one (Settings has an edited, not yet saved, value on screen).
 */
export async function runTempCleanup(mode: "manual" | "reminder", dir?: string): Promise<TempCleanupOutcome> {
    if (running) return "skipped";
    if (mode === "reminder" && !tempCleanupBridge.hasUi()) return "declined";
    running = true;
    try {
        return await askAndClean(mode, dir);
    } catch (error) {
        logger.error("Cleaning the temporary downloads failed", { error });
        await tempCleanupBridge.message({
            tone: "error",
            title: "Couldn't clean the temporary downloads",
            lines: [error instanceof Error ? error.message : String(error)],
        });
        return "failed";
    } finally {
        running = false;
        // Whatever happened, release the UI: a box left up would lock the whole app.
        tempCleanupBridge.close();
    }
}

async function askAndClean(mode: "manual" | "reminder", dir?: string): Promise<TempCleanupOutcome> {
    // A manual clean-up shows it is busy while it looks; the reminder looks silently (nothing may flash at start-up).
    if (mode === "manual") tempCleanupBridge.working("Temporary downloads", "Looking at the temporary files…");

    const found = await inspect(dir);
    if (!found.ok) {
        logger.warn(`Temporary downloads were not cleaned: ${found.dir || "(no folder)"} — ${found.reason}`);
        if (mode === "reminder") return "refused";
        await tempCleanupBridge.message({
            tone: "warning",
            title: "Can't clean this folder",
            lines: [
                found.dir || "(no folder set)",
                found.reason,
                "Nothing was deleted. Pick a dedicated folder for temporary downloads in Settings.",
            ],
        });
        return "refused";
    }

    const summaries = summarizeByAge(found.groups, found.index);
    const total = sumGroups(found.groups);
    if (mode === "reminder") {
        const worthMentioning = summaries.find((s) => s.age.key === REMINDER_MIN_AGE.key);
        if (!worthMentioning || worthMentioning.files === 0) return "nothing";
    } else if (total.files === 0) {
        await tempCleanupBridge.message({
            tone: "success",
            title: "Nothing to clean",
            lines: [`There are no temporary downloads in ${found.dir}.`],
        });
        return "nothing";
    }

    const options: TempCleanupOption[] = summaries.map((s) => ({
        key: s.age.key,
        label: s.age.label,
        files: s.files,
        bytes: s.bytes,
        liveFiles: s.liveFiles,
    }));
    const choice = await tempCleanupBridge.choose({
        mode,
        dir: found.dir,
        totalFiles: total.files,
        totalBytes: total.bytes,
        options,
        initialKey: findTempAge(getMusicSettings().download.tempCleanupAge).key,
    });
    if (mode === "reminder") patchDownloadSettings({ tempCleanupRemindedAt: new Date().toISOString() });

    if (choice.action === "never") {
        patchDownloadSettings({ tempCleanupReminder: false });
        logger.info("Temporary downloads reminder switched off by the user");
        return "silenced";
    }
    if (choice.action === "later") return "declined";

    const age = findTempAge(choice.ageKey);
    patchDownloadSettings({ tempCleanupAge: age.key });

    // The user took their time over the dialog and downloads kept running: decide on how things are now.
    tempCleanupBridge.working(CLEANING_TITLE, "Looking at the temporary files…");
    const fresh = await inspect(found.dir);
    if (!fresh.ok) throw new Error(fresh.reason);
    const result = await deleteForAge(fresh, age);

    await tempCleanupBridge.message({
        tone: result.failed > 0 ? "warning" : "success",
        title: result.files > 0 ? "Temporary downloads cleaned" : "Nothing to clean",
        lines: result.files > 0 ? resultLines(result) : [`No temporary download was unused for ${age.label}.`],
    });
    return result.files > 0 ? "cleaned" : "nothing";
}

/**
 * Deletes, without asking, the temporary downloads no session has used for 48 hours. The UI is blocked behind a
 * progress box only if there is something to delete.
 */
export async function runAutoTempCleanup(): Promise<TempCleanupOutcome> {
    if (running) return "skipped";
    running = true;
    try {
        const found = await inspect();
        if (!found.ok) {
            logger.warn(`Automatic clean-up skipped: ${found.dir || "(no folder)"} — ${found.reason}`);
            return "refused";
        }
        if (selectTempGroups(found.groups, found.index, AUTO_CLEAN_AGE).length === 0) return "nothing";
        const result = await deleteForAge(found, AUTO_CLEAN_AGE);
        return result.files > 0 ? "cleaned" : "nothing";
    } catch (error) {
        logger.error("Automatic clean-up of the temporary downloads failed", { error });
        return "failed";
    } finally {
        running = false;
        tempCleanupBridge.close();
    }
}

/** At start-up, once the last session is loaded: clean automatically, or remind (at most once a day), or neither. */
export async function runStartupTempMaintenance(): Promise<void> {
    const { autoDeleteUnusedTemp, tempCleanupReminder, tempCleanupRemindedAt } = getMusicSettings().download;
    if (autoDeleteUnusedTemp) {
        await runAutoTempCleanup();
        return;
    }
    if (!tempCleanupReminder) return;
    const last = Date.parse(tempCleanupRemindedAt);
    if (Number.isFinite(last) && Date.now() - last < REMINDER_INTERVAL_MS) return;
    await runTempCleanup("reminder");
}

// ── Disk usage, for Settings ────────────────────────────────────────────────

export type TempUsage =
    | { ok: true; files: number; bytes: number; unusedFiles: number; unusedBytes: number }
    | { ok: false; reason: string };

/** How much the app's temp files in `dir` take, and how much of it nothing has used for a week. Never throws. */
export async function getTempUsage(dir: string): Promise<TempUsage> {
    try {
        const found = await inspect(dir);
        if (!found.ok) return { ok: false, reason: found.reason };
        const total = sumGroups(found.groups);
        const unused = sumGroups(selectTempGroups(found.groups, found.index, REMINDER_MIN_AGE));
        return {
            ok: true,
            files: total.files,
            bytes: total.bytes,
            unusedFiles: unused.files,
            unusedBytes: unused.bytes,
        };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

/** The one-line text of the Settings row; `undefined` while the figures are still being worked out. */
export function describeTempUsage(usage: TempUsage | undefined): string {
    if (!usage) return "calculating…";
    if (!usage.ok) return `unavailable (${usage.reason})`;
    if (usage.files === 0) return "empty";
    const unused =
        usage.unusedFiles > 0 ? `, ${formatSize(usage.unusedBytes)} unused for ${REMINDER_MIN_AGE.label}` : "";
    return `${formatSize(usage.bytes)} in ${plural(usage.files, "file")}${unused}`;
}

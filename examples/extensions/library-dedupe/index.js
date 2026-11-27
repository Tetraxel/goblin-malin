// @ts-check
import { findOwned } from "./match.js";

/**
 * Library dedupe: removes from the list the tracks already in a music folder of yours.
 *
 * - an Actions item, "Remove tracks already in my library";
 * - a Claude tool, `library_dedupe__find_owned`, so the chat can answer "which of these do I already have?".
 *
 * Try it from a checkout:  yarn run dev --extension examples/extensions/library-dedupe
 *
 * @param {import("goblin-malin/extension-api").GoblinApi} goblin
 */
export default function activate(goblin) {
    /** The tracks worth comparing: not saved by the app yet (a saved one would only match itself) and not busy. */
    const candidates = () =>
        /** @type {import("goblin-malin/extension-api").TrackView[]} */ (goblin.tasks.list({ kind: "track" })).filter(
            (t) => !t.savedFile && !t.busy
        );

    /** @param {string} folder @param {AbortSignal} [signal] */
    const scan = async (folder, signal) => {
        const files = await goblin.files.scanAudio(folder, {
            probeDuration: goblin.settings.get("matchDuration") === true,
            signal,
        });
        const matches = findOwned(candidates(), files, { useDuration: goblin.settings.get("matchDuration") === true });
        goblin.log.info(
            `Scanned ${files.length} file(s) in ${folder}: ${matches.length} track(s) of the list are there`
        );
        return { files, matches };
    };

    goblin.actions.register({
        id: "removeOwned",
        label: "Remove tracks already in my library",
        description: "Reads the tags of a folder of yours and removes from the list the tracks found there",
        unavailableReason: () => (candidates().length === 0 ? "No track of the list is left to compare" : undefined),
        run: async () => {
            const remembered = goblin.settings.get("libraryFolder");
            const folder = await goblin.dialog.input({
                title: "Your music library",
                message: "The folder to compare the list with (its sub-folders too)",
                initialValue: typeof remembered === "string" && remembered ? remembered : goblin.paths.outputDir(),
            });
            if (folder === null || folder.trim() === "") return;
            goblin.settings.set("libraryFolder", folder.trim());

            /** @type {{ trackId: string, file: string, by: string }[]} */
            let found = [];
            const answer = await goblin.dialog.choose({
                title: "Already in your library",
                items: [],
                loadingLabel: `Reading the tags of ${folder.trim()}…`,
                body: scan(folder.trim()).then(({ files, matches }) => {
                    found = matches;
                    if (matches.length === 0) {
                        return {
                            intro: `None of the ${candidates().length} track(s) of the list is among the ${files.length} file(s) of this folder.`,
                            items: [],
                            noneLabel: "OK",
                        };
                    }
                    return {
                        intro: `${matches.length} track(s) of the list are already among the ${files.length} file(s) of this folder. Choose the first line to remove them; any other shows that file.`,
                        items: [
                            { label: `Remove these ${matches.length} track(s) from the list…` },
                            ...matches.map((m) => {
                                const t = goblin.tasks.get(m.trackId);
                                const title =
                                    t && t.kind === "track"
                                        ? [t.title ?? t.url, t.artists.join(", ")].join(" – ")
                                        : m.trackId;
                                return {
                                    label: title,
                                    detail: [`${m.by === "isrc" ? "same ISRC" : "same artist and title"}: ${m.file}`],
                                };
                            }),
                        ],
                        noneLabel: "Keep them all",
                    };
                }),
            });
            if (!answer || !("index" in answer)) return;
            if (answer.index > 0) {
                goblin.reveal(found[answer.index - 1].file);
                return;
            }
            const removed = await goblin.tasks.remove(
                found.map((m) => m.trackId),
                { reason: "They are already in your library folder." }
            );
            goblin.log.info(`Removed ${removed.length} track(s) already in the library`);
        },
    });

    goblin.agent.defineTool({
        name: "find_owned",
        summary:
            "Lists the tracks of the task list that are already in the user's music library folder (matched by ISRC, else by artist, title and duration). Reads only; removing them is the user's call.",
        kind: "read",
        locks: "none",
        input: {
            type: "object",
            additionalProperties: false,
            properties: {
                folder: { type: "string", description: "Leave out to use the folder from the extension's settings." },
            },
        },
        example: {},
        run: async (input, ctx) => {
            const folder = /** @type {string} */ (input.folder || goblin.settings.get("libraryFolder") || "");
            if (!folder) return { error: "No library folder is set (Settings → Extensions → Library dedupe)." };
            const { files, matches } = await scan(folder, ctx.signal);
            return { scannedFiles: files.length, owned: matches.map((m) => ({ taskId: m.trackId, matchedBy: m.by })) };
        },
    });
}

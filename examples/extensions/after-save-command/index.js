// @ts-check
import path from "node:path";
import { expandCommand, HANDLER_TIMEOUT_MS, shellFor, TIMEOUTS } from "./command.js";

/**
 * After-save command: runs a command line of yours for each saved track. It covers "user scripts" in any language
 * without a built-in feature: `beet import -q {path}`, `rsync {path} nas:/music/`, `python3 ~/notify.py`…
 *
 * Placeholders are replaced by the track's values, quoted for the shell. The whole event is also written to the
 * command's stdin as JSON. The command runs without the app's credentials in its environment, is killed when the app
 * closes, and after its time limit.
 *
 * @param {import("goblin-malin/extension-api").GoblinApi} goblin
 */
export default function activate(goblin) {
    const off = goblin.on(
        "track.saved",
        async ({ track, path: file, format }, { signal }) => {
            const template = String(goblin.settings.get("command") ?? "").trim();
            if (!template) return;
            const line = expandCommand(template, {
                path: file,
                dir: path.dirname(file),
                file: path.basename(file),
                artist: track.artists.join(", "),
                title: track.title ?? "",
                album: track.album ?? "",
                isrc: track.isrc ?? "",
                format,
            });
            const { command, args } = shellFor(line);
            const timeoutMs =
                TIMEOUTS[/** @type {keyof typeof TIMEOUTS} */ (goblin.settings.get("timeout"))] ?? 120_000;
            goblin.log.info(`Running: ${line}`);
            const result = await goblin.spawn(command, args, {
                input: JSON.stringify({ event: "track.saved", path: file, format, track }),
                signal,
                timeoutMs,
            });
            const output = (result.stdout + result.stderr).trim().split("\n").slice(-5).join("\n");
            if (result.code === 0) {
                goblin.log.info(`Done for ${path.basename(file)}${output ? `:\n${output}` : ""}`);
                return;
            }
            const why = result.signal ? `stopped (${result.signal})` : `exit code ${result.code}`;
            goblin.log.warn(`The command failed for ${path.basename(file)} (${why})${output ? `:\n${output}` : ""}`);
            if (goblin.settings.get("notifyFailures") === true) {
                await goblin.dialog.notify("After-save command failed", `${path.basename(file)}: ${why}\n\n${output}`);
            }
        },
        // The handler's own limit is the bus' longest: above any time limit the command can be given.
        { timeoutMs: HANDLER_TIMEOUT_MS }
    );

    goblin.settings.rows(() => [
        {
            kind: "note",
            text: "Example: beet import -q {path}   ·   leave empty to do nothing",
        },
    ]);

    return () => off();
}

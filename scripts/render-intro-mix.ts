/**
 * Renders the intro's soundtrack (`INTRO_CUES`, or `OUTRO_CUES` with `--outro`) to a WAV file, faster than real
 * time, through the same mpv filter graph the app plays. Nobody has to listen to compare two versions of the
 * sound files: render both and run `scripts/compare-audio.mjs` on the results.
 *
 *   yarn tsx scripts/render-intro-mix.ts out.wav [--seconds 60] [--outro]
 *
 * It needs the mpv the app downloaded (`<data dir>/bin/mpv_*.exe`, or `mpv` on the PATH).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { INTRO_CUES, OUTRO_CUES } from "../src/components/WelcomeModal/intro/introSounds";
import { buildMixGraph, mixFiles } from "../src/utils/mpvMix";

const out = process.argv[2];
if (!out || out.startsWith("--")) {
    process.stderr.write("Usage: tsx scripts/render-intro-mix.ts <out.wav> [--seconds N] [--outro]\n");
    process.exit(1);
}
const secondsFlag = process.argv.indexOf("--seconds");
const seconds = secondsFlag >= 0 ? Number(process.argv[secondsFlag + 1]) : undefined;
const cues = process.argv.includes("--outro") ? OUTRO_CUES : INTRO_CUES;

function findMpv(): string {
    const binDir = path.resolve("data", "bin");
    const local = fs.existsSync(binDir) ? fs.readdirSync(binDir).filter((f) => /^mpv.*\.exe$|^mpv_/.test(f)) : [];
    return local.length > 0 ? path.join(binDir, local.sort().pop()!) : "mpv";
}

// Same arguments as MpvMix, minus the IPC socket, plus a PCM file as the audio output.
const cwd = path.dirname(cues[0]!.file);
const [first, ...others] = mixFiles(cues).map((file) => path.relative(cwd, file));
const result = spawnSync(
    findMpv(),
    [
        "--no-config",
        "--no-video",
        "--no-terminal",
        "--volume=100",
        "--ao=pcm",
        `--ao-pcm-file=${path.resolve(out)}`,
        ...(seconds ? [`--end=${seconds}`] : []),
        ...others.map((file) => `--external-file=${file}`),
        `--lavfi-complex=${buildMixGraph(cues)}`,
        "--",
        first!,
    ],
    { cwd, env: { ...process.env, PWD: cwd }, stdio: "inherit" }
);
process.exit(result.status ?? 1);

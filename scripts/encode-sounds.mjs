/**
 * Encodes the app's sound files from their originals (WAV / MP3) to Ogg Vorbis, the form they ship in.
 *
 *   node scripts/encode-sounds.mjs <source folder> <destination folder>
 *
 * Why Vorbis, and these settings: the originals are 125 MB (24/32-bit WAV at up to 96 kHz, an 8-minute 320 kb/s
 * song) and were downloaded again with every release. mpv plays Ogg with no setup, and Vorbis keeps each file's own
 * sample rate, which the cue sheet depends on (`pitched(96000, ...)` and `loopSamples` in introSounds.ts count in the
 * source's samples), unlike Opus, which is always 48 kHz.
 *
 * - Sound effects and music loops: quality 6 (about 192 kb/s per channel pair), more than enough for sounds that are
 *   short, mixed with others and played through a terminal app's `--volume=50`.
 * - `outro.mp3`: the whole song, quality 4 (about 128 kb/s): the user can sit on the finale for as long as they like.
 * - `DroneDemonic_BW.12015.wav` is 93 s long, but the intro only uses its first DRONE_SECONDS (see introSounds.ts):
 *   the rest is cut off, at the end only, so every `from` offset stays valid.
 *
 * Check a re-encode with `scripts/render-intro-mix.ts` and `scripts/compare-audio.mjs`. Needs ffmpeg with libvorbis.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , sourceDir, destDir] = process.argv;
if (!sourceDir || !destDir) {
    process.stderr.write("Usage: node scripts/encode-sounds.mjs <source folder> <destination folder>\n");
    process.exit(1);
}

/** Keep in step with DRONE_SECONDS in src/components/WelcomeModal/intro/introSounds.ts. */
const DRONE_SECONDS = 36;
const RULES = {
    "outro.mp3": { quality: 4 },
    "DroneDemonic_BW.12015.wav": { quality: 6, seconds: DRONE_SECONDS },
};

fs.mkdirSync(destDir, { recursive: true });
let before = 0;
let after = 0;
for (const name of fs.readdirSync(sourceDir).sort()) {
    if (!/\.(wav|mp3)$/i.test(name)) continue;
    const source = path.join(sourceDir, name);
    const dest = path.join(destDir, name.replace(/\.(wav|mp3)$/i, ".ogg"));
    const { quality = 6, seconds } = RULES[name] ?? {};
    const args = [
        "-y",
        "-v",
        "error",
        "-i",
        source,
        ...(seconds ? ["-t", String(seconds)] : []),
        "-map_metadata",
        "-1",
        "-c:a",
        "libvorbis",
        "-q:a",
        String(quality),
        dest,
    ];
    const result = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    if (result.status !== 0) {
        process.stderr.write(`ffmpeg failed on ${name}\n`);
        process.exit(1);
    }
    before += fs.statSync(source).size;
    after += fs.statSync(dest).size;
}
const mb = (n) => (n / 1048576).toFixed(1);
process.stdout.write(`${mb(before)} MB -> ${mb(after)} MB\n`);

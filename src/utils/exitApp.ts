import { cache } from "#utils/cache";

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

/** Leaves the alternate screen, saves the cache and ends the process. */
export function exitApp(): never {
    process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
    console.info("Saving cache before exit…");
    cache.save();
    process.exit(0);
}

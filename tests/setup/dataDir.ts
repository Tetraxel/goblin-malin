import os from "node:os";
import path from "node:path";

/**
 * Test files run in parallel processes: giving each worker its own data folder keeps two files that write
 * `settings.json` (or any other file of the folder) at the same moment from fighting over it (on Windows the second
 * rename fails). A worker runs one file at a time and the pool's ids are reused, so there are only a few folders.
 * Runs before the test file's imports, so `DEFAULT_APP_DATA_DIR` reads this value.
 */
process.env.GOBLIN_DATA_DIR = path.join(os.tmpdir(), `goblin-malin-tests-${process.env.VITEST_POOL_ID ?? "0"}`);

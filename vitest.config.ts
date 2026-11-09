import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 30000,
        environment: "node",
        pool: "forks",
        env: {
            GOBLIN_NO_AUDIO: "1",
            // Keep test runs out of the developer's real data folder (`data/` in a checkout): the logger
            // alone would otherwise rotate the running app's `app.log` away on every run.
            GOBLIN_DATA_DIR: path.join(os.tmpdir(), "goblin-malin-tests"),
        },
    },
});

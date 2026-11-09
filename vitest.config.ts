import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 30000,
        // `yarn test:coverage` (unit tests only: the e2e scenarios run the app in a child process, which the
        // report cannot see). Reported, not enforced: there is no threshold to fail on.
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/**/*.d.ts", "src/profiling/**", "src/assets/**"],
            reporter: ["text-summary", "json-summary", "lcov"],
            reportsDirectory: "coverage",
        },
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

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 30000,
        environment: "node",
        pool: "forks",
        env: { GOBLIN_NO_AUDIO: "1" },
    },
});

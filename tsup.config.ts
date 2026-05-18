import { defineConfig } from "tsup";
import { cpSync } from "fs";

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  async onSuccess() {
    cpSync("src/assets", "dist/assets", { recursive: true });
  },
});

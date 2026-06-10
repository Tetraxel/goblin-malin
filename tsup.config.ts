import { defineConfig } from "tsup";
import { cpSync } from "fs";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);
const pkg = _require("./package.json") as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  async onSuccess() {
    cpSync("src/assets", "dist/assets", { recursive: true });
  },
});

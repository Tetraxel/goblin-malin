// Profiling entrypoint. The TUI test harness spawns this instead of the normal
// `src/cli.ts` when a scenario opts into profiling. Importing `./install` first
// (for its side effects) guarantees the global devtools hook and DEV=true are
// in place before the app pulls in Ink and the React reconciler.
import "./install";
import { start } from "../index";

start();

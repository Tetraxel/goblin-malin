#!/usr/bin/env node
// React and Ink pick their development-vs-production build from NODE_ENV the
// first time they are imported. That decision has to be made BEFORE ./index
// (which pulls in React) is evaluated — ES module imports are hoisted, so a
// static `import` would run too late. Hence the dynamic import below.
//
// The npm scripts set NODE_ENV explicitly (dev → development, start → production
// via cross-env). The published binary (`dist/cli.js` from the bin field) has no
// wrapping script, so default it to the production build here — ~1.5–2× faster
// renders and no dev-only invariants for end users.
if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "production";
}

// Answered before anything is loaded: `--version` and `--help` must not open the interface.
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
    const { APP_VERSION } = await import("./constants");
    process.stdout.write(`${APP_VERSION}\n`);
    process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
        "Goblin Malin: a terminal app to download and tag music tracks.\n\n" +
            "Usage: goblin-malin [--version] [--help] [--no-extensions] [--extension <folder>]...\n" +
            "       goblin-malin ext <list | add <folder | git URL> | remove <name> | new <name> [folder]>\n\n" +
            "Run it with no argument, in a terminal, to start. Set GOBLIN_DATA_DIR to keep its data in another folder.\n" +
            "  --no-extensions        start without any extension (also GOBLIN_NO_EXTENSIONS=1)\n" +
            "  --extension <folder>   load an extension from this folder without asking (for its author; repeatable)\n" +
            "  ext ...                manage the extensions folder (see docs/extensions.md)\n"
    );
    process.exit(0);
}
// Managing extensions works without a terminal UI (and never opens it).
if (args[0] === "ext") {
    const { runExtCommand } = await import("./extensions/extCli");
    process.exit(await runExtCommand(args.slice(1)));
}
// The interface needs a terminal to draw in and read keys from. Started from a pipe, a service or a script it would
// only fail with an internal error and never exit.
if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("Goblin Malin needs an interactive terminal (stdin and stdout must be a TTY).\n");
    process.exit(1);
}

// Thin entry point with a shebang used by the bin field so `npx goblin-malin` works.
const { start } = await import("./index");
const { redirectConsoleToLog } = await import("./base/logger/redirectConsole");
redirectConsoleToLog();
await start();
// Ink replaces the console methods when it starts (to print above the UI); the app log is where they must go.
redirectConsoleToLog();

// Marks this file as an ES module so the top-level `await` above is allowed.
export {};

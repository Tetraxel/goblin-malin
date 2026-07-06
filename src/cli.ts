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

// Thin entry point with a shebang used by the bin field so `npx goblin-malin` works.
const { start } = await import("./index");
start();

// Marks this file as an ES module so the top-level `await` above is allowed.
export {};

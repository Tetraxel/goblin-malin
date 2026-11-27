// Test fixture (tests/e2e/extensions.test.ts): what a careless extension does while it loads, offline.
export default async function activate(goblin) {
    // A request with no .catch: with no network it rejects, and nobody handles it.
    goblin.fetch("http://127.0.0.1:9/never", { timeoutMs: 500 }).then(() => {});
    Promise.reject(new Error("stray rejection from an extension"));
    // Time for Node to notice the rejections while `start()` is still waiting for the extensions.
    await new Promise((resolve) => setTimeout(resolve, 50));
}

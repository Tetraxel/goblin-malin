// Preloaded into the app (`NODE_OPTIONS=--import <this file>`) when a scenario has a `network` section.
// It replaces `globalThis.fetch`: a request is answered by the first matching rule of the rules file, fails like a
// missing connection (`offline`, the default) or goes out (`passthrough`). Every request is appended to a JSONL log
// the harness reads (`assertRequest`). The rules file is read again on every request, so a scenario's `network` step
// changes the answers while the app runs.
//
// Plain JavaScript on purpose: it runs before the app's TypeScript loader is installed.
/* global process, setTimeout, clearTimeout, URL, Response, DOMException */
import fs from "node:fs";

const rulesFile = process.env.GOBLIN_TEST_NETWORK_RULES;
const logFile = process.env.GOBLIN_TEST_NETWORK_LOG;
const realFetch = globalThis.fetch;
/** How many requests each rule has answered (rules are identified by their text, so a changed file starts over). */
const used = new Map();

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(rulesFile, "utf-8"));
    } catch {
        return { mode: "offline", rules: [] };
    }
}

function log(entry) {
    if (!logFile) return;
    try {
        fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
    } catch {
        /* the log is only for the harness */
    }
}

function ruleApplies(rule, url, method) {
    if (rule.method && rule.method.toUpperCase() !== method) return false;
    if (rule.url !== undefined && !url.includes(rule.url)) return false;
    if (rule.matches !== undefined && !new RegExp(rule.matches).test(url)) return false;
    return true;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            },
            { once: true }
        );
    });
}

function connectionError(message) {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error(message), { code: "ECONNREFUSED" });
    return error;
}

globalThis.fetch = async function fakeFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = String(
        init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
    ).toUpperCase();
    // Not the network: a library loading its WebAssembly from a `data:` URL, a local file. Never logged nor refused,
    // or the offline mode would change what the app does without a single request leaving the machine.
    if (/^(data|blob|file):/i.test(url)) return realFetch(input, init);
    const config = readConfig();
    const rules = config.rules ?? [];

    for (const rule of rules) {
        if (!ruleApplies(rule, url, method)) continue;
        const key = JSON.stringify(rule);
        const count = used.get(key) ?? 0;
        if (rule.times !== undefined && count >= rule.times) continue;
        used.set(key, count + 1);

        if (rule.delayMs) await sleep(rule.delayMs, init?.signal);
        if (rule.error !== undefined) {
            log({ method, url, outcome: "error" });
            throw connectionError(rule.error);
        }
        let body;
        const headers = { ...(rule.headers ?? {}) };
        if (rule.json !== undefined) {
            body = JSON.stringify(rule.json);
            headers["content-type"] ??= "application/json";
        } else if (rule.bodyFile !== undefined) {
            body = fs.readFileSync(rule.bodyFile);
        } else {
            body = rule.body ?? "";
        }
        const status = rule.status ?? 200;
        log({ method, url, outcome: "stub", status });
        // A 204/304 may not have a body.
        return new Response(status === 204 || status === 304 ? null : body, { status, headers });
    }

    if (config.mode === "passthrough") {
        log({ method, url, outcome: "passthrough" });
        return realFetch(input, init);
    }
    log({ method, url, outcome: "offline" });
    throw connectionError(`fake network: no rule for ${method} ${url}`);
};

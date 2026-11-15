import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { SettingsStore } from "#settings/settingsStore";
import { AgentRuntime } from "#flows/musicDownloadFlow/agent/agentRuntime";
import { AgentChat } from "#flows/musicDownloadFlow/agent/agentChat";
import { ChatStore } from "#flows/musicDownloadFlow/agent/chatStore";
import { type SavedChat } from "#flows/musicDownloadFlow/agent/chatHistory";
import { type AgentLogEntry } from "#flows/musicDownloadFlow/agent/agentLog";
import { getAgentSettings } from "#flows/musicDownloadFlow/agent/agentSettings";
import { resetAgentConsentForTesting } from "#flows/musicDownloadFlow/agent/consent";
import { selectionHeader } from "#flows/musicDownloadFlow/agent/agentPrompt";
import {
    buildAgentArgs,
    buildMcpConfig,
    createLineSplitter,
    parseAgentStreamLine,
    runAgentCli,
    type AgentCliEvent,
    type RunAgentCliOptions,
} from "#flows/musicDownloadFlow/services/apis/claude-agent-client";
import { ClaudeCliError, ClaudeClient } from "#flows/musicDownloadFlow/services/apis/claude-client";
import { agentJournal } from "#flows/musicDownloadFlow/agent/taskAccess";
import { installWorld, makeTrack } from "./helpers/agentWorld";

const FAKE_CLAUDE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude.mjs");

describe("the CLI's stream", () => {
    const line = (o: unknown) => JSON.stringify(o);

    test("turns each kind of line into events, and ignores the rest", () => {
        expect(parseAgentStreamLine(line({ type: "system", subtype: "init", session_id: "s1", tools: [] }))).toEqual([
            { type: "session", sessionId: "s1" },
        ]);
        expect(parseAgentStreamLine(line({ type: "system", subtype: "status" }))).toEqual([]);
        expect(
            parseAgentStreamLine(
                line({
                    type: "stream_event",
                    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
                })
            )
        ).toEqual([{ type: "text-delta", text: "Hi" }]);
        expect(
            parseAgentStreamLine(
                line({
                    type: "stream_event",
                    event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } },
                })
            )
        ).toEqual([]);
        expect(
            parseAgentStreamLine(
                line({
                    type: "assistant",
                    message: {
                        content: [
                            { type: "text", text: "Looking." },
                            { type: "tool_use", id: "tu1", name: "mcp__goblin__get_task", input: { taskId: "a" } },
                        ],
                    },
                })
            )
        ).toEqual([
            { type: "assistant-text", text: "Looking." },
            { type: "tool-use", id: "tu1", name: "get_task", input: { taskId: "a" } },
        ]);
        expect(
            parseAgentStreamLine(
                line({
                    type: "user",
                    message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true }] },
                })
            )
        ).toEqual([{ type: "tool-result", id: "tu1", isError: true }]);
        // What the tool answered comes with it, as text, from a string or from blocks.
        const result = (content: unknown) =>
            parseAgentStreamLine(
                line({
                    type: "user",
                    message: { content: [{ type: "tool_result", tool_use_id: "tu2", content }] },
                })
            );
        expect(result('{"ok":true}')).toEqual([
            { type: "tool-result", id: "tu2", isError: false, output: '{"ok":true}' },
        ]);
        expect(result([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toEqual([
            { type: "tool-result", id: "tu2", isError: false, output: "a\nb" },
        ]);
        expect(
            parseAgentStreamLine(
                line({
                    type: "result",
                    subtype: "success",
                    is_error: false,
                    result: "Done",
                    session_id: "s1",
                    total_cost_usd: 0.5,
                    num_turns: 3,
                    duration_ms: 9,
                })
            )
        ).toEqual([{ type: "result", ok: true, text: "Done", sessionId: "s1", costUsd: 0.5, turns: 3, durationMs: 9 }]);
        expect(
            parseAgentStreamLine(line({ type: "result", subtype: "error_max_turns", is_error: true, result: "boom" }))
        ).toMatchObject([{ type: "result", ok: false, text: "boom" }]);
        expect(parseAgentStreamLine("not json")).toEqual([]);
        expect(parseAgentStreamLine(line([1, 2]))).toEqual([]);
    });

    test("a run stopped by a limit has no text but is still a failure, and says which limit", async () => {
        expect(
            parseAgentStreamLine(line({ type: "result", subtype: "error_max_budget_usd", is_error: false }))
        ).toMatchObject([{ type: "result", ok: false, text: expect.stringContaining("error_max_budget_usd") }]);

        // Through the process: the run is rejected, not resolved as if it had finished.
        const script = path.join(os.tmpdir(), `goblin-limit-${process.pid}.mjs`);
        fs.writeFileSync(
            script,
            'process.stdout.write(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: false }) + "\\n");'
        );
        try {
            await expect(
                runAgentCli({
                    command: process.execPath,
                    args: [script],
                    prompt: "hi",
                    token: "t",
                    signal: new AbortController().signal,
                    onEvent: () => {},
                })
            ).rejects.toThrow(/error_max_turns/);
        } finally {
            fs.rmSync(script, { force: true });
        }
    });

    test("lines may arrive in pieces", () => {
        const got: string[] = [];
        const splitter = createLineSplitter((l) => got.push(l));
        splitter.push('{"a":');
        splitter.push("1}\n{");
        splitter.push('"b":2}\n\n{"c":3}');
        expect(got).toEqual(['{"a":1}', '{"b":2}']);
        splitter.end();
        expect(got).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    });
});

describe("how the CLI is started", () => {
    const base = {
        model: "sonnet",
        systemPrompt: "SYS",
        mcpConfigPath: "/tmp/c.json",
        tools: ["get_task", "select_source"],
    };

    test("no built-in tool at all, one MCP server, only the app's tools allowed, by name", () => {
        const args = buildAgentArgs({ ...base, sessionId: "id1", resume: false });
        expect(args[args.indexOf("--tools") + 1]).toBe("");
        expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
        expect(args).toContain("--strict-mcp-config");
        expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/c.json");
        expect(args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--allowedTools") + 3)).toEqual([
            "mcp__goblin__get_task",
            "mcp__goblin__select_source",
        ]);
        // A denylist would stop covering a tool the CLI adds later: there is none.
        expect(args).not.toContain("--disallowedTools");
        expect(args).not.toContain("--dangerously-skip-permissions");
        // A runaway loop of tool calls stops by itself.
        expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
        // The conversation is kept so the next message can resume it.
        expect(args).not.toContain("--no-session-persistence");
    });

    test("the first message names the session, the next ones resume it", () => {
        const first = buildAgentArgs({ ...base, sessionId: "id1", resume: false });
        const next = buildAgentArgs({ ...base, sessionId: "id1", resume: true });
        expect(first[first.indexOf("--session-id") + 1]).toBe("id1");
        expect(first).not.toContain("--resume");
        expect(next[next.indexOf("--resume") + 1]).toBe("id1");
        expect(next).not.toContain("--session-id");
    });

    test("the token is never in the arguments or the config: it is named by an environment variable", () => {
        const config = JSON.parse(buildMcpConfig("http://127.0.0.1:1234/mcp"));
        expect(config.mcpServers.goblin).toEqual({
            type: "http",
            url: "http://127.0.0.1:1234/mcp",
            headers: { Authorization: "Bearer ${GOBLIN_AGENT_TOKEN}" },
        });
    });

    test("the selection goes in front of the message, short", () => {
        expect(selectionHeader([])).toBe("");
        expect(selectionHeader(["task:3d6da40a5c5c"])).toContain("selected 1 task, with these task ids");
        expect(selectionHeader(["task:3d6da40a5c5c"])).toContain('["task:3d6da40a5c5c"]');
        const many = selectionHeader(Array.from({ length: 30 }, (_, i) => `t${i}`));
        expect(many).toContain("30 tasks");
        expect(many).toContain("and 10 more");
        expect(many).not.toContain("t25");
    });
});

describe("ChatStore", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test("a tool line keeps what was sent and what came back, raw, and can be opened one by one or all at once", () => {
        const store = new ChatStore(300);
        store.addTool("t1", "get_task a", { taskId: "a" });
        store.finishTool("t1", false, '{"revision":3}');
        store.addTool("t2", "get_task b", { taskId: "b" });
        const [one, two] = store.getSnapshot().messages;
        expect(one.detail).toEqual({ input: '{"taskId":"a"}', output: '{"revision":3}' });
        expect(two.detail).toEqual({ input: '{"taskId":"b"}' });
        expect(one.expanded).toBeUndefined();

        store.toggleTool(one.id);
        expect(store.getSnapshot().messages[0].expanded).toBe(true);
        expect(store.getSnapshot().messages[1].expanded).toBeUndefined();

        // "All": opens the rest, and the calls that come next; again, closes them all.
        store.toggleAllTools();
        expect(store.getSnapshot().messages.map((m) => m.expanded)).toEqual([true, true]);
        store.addTool("t3", "get_task c", {});
        expect(store.getSnapshot().messages[2].expanded).toBe(true);
        store.toggleAllTools();
        expect(store.getSnapshot().messages.map((m) => m.expanded)).toEqual([false, false, false]);
        store.addTool("t4", "get_task d", {});
        expect(store.getSnapshot().messages[3].expanded).toBeUndefined();
    });

    test("a very long answer is cut, and a line that is not a tool cannot be opened", () => {
        const store = new ChatStore(300);
        store.addTool("t1", "list_tasks", {});
        store.finishTool("t1", false, "x".repeat(20_000));
        const output = store.getSnapshot().messages[0].detail!.output!;
        expect(output.length).toBeLessThan(8100);
        expect(output).toMatch(/12000 more characters\)$/);
        store.addNote("hello");
        const note = store.getSnapshot().messages[1];
        store.toggleTool(note.id);
        expect(store.getSnapshot().messages[1].expanded).toBeUndefined();
    });

    test("a saved conversation comes back with ids that go on, details closed, and nothing 'running'", () => {
        const store = new ChatStore(300);
        store.restore([
            { id: 4, role: "user", text: "hi" },
            { id: 7, role: "tool", text: "get_task a", state: "running", detail: { input: "{}" }, expanded: true },
        ]);
        const [, tool] = store.getSnapshot().messages;
        expect(tool).toMatchObject({ state: "failed", expanded: false });
        store.addUser("again");
        expect(store.getSnapshot().messages.at(-1)!.id).toBe(8);
    });

    test("streamed text reaches the screen a few times a second, not once per word", () => {
        const store = new ChatStore(300);
        let commits = 0;
        store.subscribe(() => commits++);
        for (let i = 0; i < 50; i++) store.appendAssistant("word ");
        expect(commits).toBe(0);
        vi.advanceTimersByTime(299);
        expect(commits).toBe(0);
        vi.advanceTimersByTime(2);
        expect(commits).toBe(1);
        expect(store.getSnapshot().messages[0].text).toBe("word ".repeat(50));
        for (let i = 0; i < 50; i++) store.appendAssistant("more ");
        vi.advanceTimersByTime(300);
        expect(commits).toBe(2);
        // The same message grew; no new one.
        expect(store.getSnapshot().messages).toHaveLength(1);
    });

    test("anything that must come after the text flushes it first, in order", () => {
        const store = new ChatStore();
        store.appendAssistant("Let me look. ");
        store.addTool("tu1", "get_task a");
        store.appendAssistant("Found it.");
        store.finishTool("tu1", false);
        expect(store.getSnapshot().messages.map((m) => `${m.role}:${m.text}`)).toEqual([
            "assistant:Let me look. ",
            "tool:get_task a",
            "assistant:Found it.",
        ]);
        expect(store.getSnapshot().messages[1].state).toBe("done");
    });

    test("the snapshot is the same object until something changes, and a tool left running is failed when the turn ends", () => {
        const store = new ChatStore();
        const first = store.getSnapshot();
        expect(store.getSnapshot()).toBe(first);
        store.setBusy(true);
        store.addTool("tu1", "rediscover");
        expect(store.getSnapshot().messages[0].state).toBe("running");
        store.setBusy(false);
        expect(store.getSnapshot().messages[0].state).toBe("failed");
        expect(store.getSnapshot().activity).toBe("");
    });

    test("usage adds up and survives a new conversation", () => {
        const store = new ChatStore();
        store.addUser("hi");
        store.addUsage(0.25, 3);
        store.addUsage(0.25, undefined);
        store.clear();
        expect(store.getSnapshot().messages).toEqual([]);
        expect(store.getSnapshot().usage).toEqual({ messages: 1, turns: 3, costUsd: 0.5 });
    });
});

describe("AgentChat", () => {
    let store: ChatStore;
    let runtime: AgentRuntime;
    let runs: RunAgentCliOptions[];
    let script: (opts: RunAgentCliOptions) => Promise<void> | void;
    let chat: AgentChat;
    // The last conversation, kept in memory instead of the data folder.
    let saved: SavedChat | undefined;
    // What the chat wrote to agent.log.
    let logged: AgentLogEntry[];

    const setAgent = (patch: Record<string, unknown>) =>
        SettingsStore.getInstance().patchMusicSettings({ agent: patch });

    beforeEach(() => {
        installWorld([makeTrack("aaa1", "Song")]);
        resetAgentConsentForTesting();
        setAgent({ enabled: true, consentAsked: true, model: "haiku" });
        store = new ChatStore(10);
        runtime = new AgentRuntime();
        runs = [];
        script = (opts) => {
            opts.onEvent({ type: "session", sessionId: "session-from-cli" });
            opts.onEvent({ type: "text-delta", text: "Hello" });
            opts.onEvent({ type: "result", ok: true, text: "Hello", costUsd: 0.01, turns: 1 });
        };
        saved = undefined;
        logged = [];
        chat = new AgentChat({
            runtime,
            store,
            log: { write: (entry) => logged.push(entry) },
            runCli: async (opts) => {
                runs.push(opts);
                await script(opts);
            },
            history: {
                save: async (chatToSave) => {
                    saved = {
                        version: 1,
                        savedAt: new Date().toISOString(),
                        sessionId: chatToSave.sessionId,
                        messages: [...chatToSave.messages],
                    };
                },
                load: async () => saved,
            },
        });
    });

    afterEach(async () => {
        await runtime.stop();
        dialogBridge.setConfirmOpener(null);
    });

    const texts = () => store.getSnapshot().messages.map((m) => `${m.role}:${m.text}`);

    test("sends the message with the selection and shows the answer", async () => {
        await chat.send("fix these", ["aaa1", "bbb2"]);
        expect(runs).toHaveLength(1);
        expect(runs[0].prompt).toContain(
            'selected 2 tasks, with these task ids (use them exactly as written, "task:" included): ["aaa1","bbb2"]'
        );
        expect(runs[0].prompt).toContain("fix these");
        expect(runs[0].args).toContain("haiku");
        store.flush();
        expect(texts()).toEqual(["user:fix these", "assistant:Hello"]);
        expect(store.getSnapshot().busy).toBe(false);
        expect(store.getSnapshot().usage).toMatchObject({ messages: 1, turns: 1 });
    });

    test("the second message resumes the conversation the CLI started", async () => {
        await chat.send("one");
        await chat.send("two");
        const arg = (i: number, flag: string) => runs[i].args[runs[i].args.indexOf(flag) + 1];
        expect(runs[0].args).toContain("--session-id");
        expect(runs[1].args).toContain("--resume");
        expect(arg(1, "--resume")).toBe("session-from-cli");
        // A new conversation starts a new session.
        chat.newConversation();
        await chat.send("three");
        expect(runs[2].args).toContain("--session-id");
        expect(arg(2, "--session-id")).not.toBe("session-from-cli");
    });

    test("agent.log gets the whole conversation raw: the message and its prompt, what Claude said, each tool call with its input and answer, the cost", async () => {
        script = (opts) => {
            opts.onEvent({ type: "session", sessionId: "s-log" });
            opts.onEvent({ type: "text-delta", text: "Let me " });
            opts.onEvent({ type: "text-delta", text: "look." });
            opts.onEvent({ type: "tool-use", id: "t1", name: "get_task", input: { taskId: "task:abc" } });
            opts.onEvent({ type: "tool-result", id: "t1", isError: false, output: '{"revision":3}' });
            opts.onEvent({ type: "text-delta", text: "Done." });
            opts.onEvent({ type: "result", ok: true, text: "Done.", costUsd: 0.02, turns: 2, durationMs: 1234 });
        };
        await chat.send("check it", ["task:abc"]);
        expect(logged.map((e) => e.kind)).toEqual([
            "user",
            "turn-start",
            "session",
            "assistant",
            "tool-call",
            "tool-result",
            "assistant",
            "result",
            "turn-end",
        ]);
        const byKind = (kind: string) => logged.filter((e) => e.kind === kind);
        expect(byKind("user")[0]).toMatchObject({ text: "check it", selectedTaskIds: ["task:abc"] });
        expect(String(byKind("user")[0].prompt)).toContain('["task:abc"]');
        expect(byKind("assistant").map((e) => e.text)).toEqual(["Let me look.", "Done."]);
        expect(byKind("tool-call")[0]).toMatchObject({ tool: "get_task", input: { taskId: "task:abc" } });
        expect(byKind("tool-result")[0]).toMatchObject({ tool: "get_task", isError: false, output: '{"revision":3}' });
        expect(byKind("result")[0]).toMatchObject({ ok: true, costUsd: 0.02, turns: 2, durationMs: 1234 });
        expect(byKind("turn-start")[0]).toMatchObject({ model: "haiku", resume: false });
        // Every line of a turn names the turn.
        const turn = byKind("turn-start")[0].turn;
        expect(byKind("tool-call")[0].turn).toBe(turn);
        expect(byKind("turn-end")[0].turn).toBe(turn);
    });

    test("notes and errors the chat shows are in the log too", async () => {
        await chat.send("/undo");
        script = () => {
            throw new ClaudeCliError("not-logged-in", "x");
        };
        await chat.send("go");
        expect(logged.some((e) => e.kind === "note" && e.text === "Nothing to undo.")).toBe(true);
        expect(logged.some((e) => e.kind === "error" && /not logged in/.test(String(e.text)))).toBe(true);
    });

    test("the conversation is kept after each answer, and can be reopened in an empty chat", async () => {
        await chat.send("remember me");
        store.flush();
        expect(saved?.sessionId).toBe("session-from-cli");
        expect(saved?.messages.map((m) => m.text)).toEqual(["remember me", "Hello"]);
        expect(await chat.lastConversation()).toMatchObject({ messages: 1, firstUserMessage: "remember me" });

        // A new launch: an empty chat, a new session. Nothing is reopened until asked.
        const fresh = new ChatStore(10);
        const second = new AgentChat({
            runtime,
            store: fresh,
            runCli: async (opts) => {
                runs.push(opts);
                await script(opts);
            },
            history: { save: async () => undefined, load: async () => saved },
        });
        expect(fresh.getSnapshot().messages).toEqual([]);
        expect(await second.reopenLast()).toBe(true);
        expect(fresh.getSnapshot().messages.map((m) => `${m.role}:${m.text}`)).toEqual([
            "user:remember me",
            "assistant:Hello",
            "note:Reopened the previous conversation.",
        ]);
        // Claude remembers it too: the next message resumes the session.
        await second.send("and now?");
        expect(runs.at(-1)!.args).toContain("--resume");
        expect(runs.at(-1)!.args[runs.at(-1)!.args.indexOf("--resume") + 1]).toBe("session-from-cli");
        // Not into a chat that already has something in it.
        expect(await second.reopenLast()).toBe(false);
    });

    test("nothing is kept for a conversation the CLI never started, and there is nothing to reopen", async () => {
        expect(await chat.reopenLast()).toBe(false);
        script = (opts) => {
            opts.onEvent({ type: "result", ok: false, text: "not logged in", costUsd: 0, turns: 0 });
            throw new ClaudeCliError("not-logged-in", "x");
        };
        await chat.send("hi");
        expect(saved).toBeUndefined();
    });

    test("every turn gets its own token, which stops working when the turn ends", async () => {
        script = (opts) => {
            expect(opts.token).toMatch(/^[0-9a-f]{64}$/);
            expect(runtime.activeTurns).toBe(1);
        };
        await chat.send("a");
        await chat.send("b");
        expect(runs[0].token).not.toBe(runs[1].token);
        expect(runtime.activeTurns).toBe(0);
        // The config file the CLI was given is removed once the turn is over.
        const configPath = runs[0].args[runs[0].args.indexOf("--mcp-config") + 1];
        expect(fs.existsSync(configPath)).toBe(false);
    });

    test("a message while Claude is answering is ignored", async () => {
        let release!: () => void;
        script = () => new Promise<void>((resolve) => (release = resolve));
        const first = chat.send("slow");
        await vi.waitFor(() => expect(runs).toHaveLength(1));
        await chat.send("impatient");
        expect(runs).toHaveLength(1);
        release();
        await first;
    });

    test("Stop aborts the turn and says so", async () => {
        script = (opts) =>
            new Promise<void>((_resolve, reject) => {
                opts.signal.addEventListener("abort", () => reject(new ClaudeCliError("aborted", "Stopped")));
                setTimeout(() => chat.stop(), 5);
            });
        await chat.send("go");
        expect(texts()).toContain("note:Stopped.");
        expect(store.getSnapshot().busy).toBe(false);
        expect(runtime.activeTurns).toBe(0);
    });

    test("tools are shown live with their result, and a failed CLI says why", async () => {
        script = (opts) => {
            opts.onEvent({ type: "tool-use", id: "t1", name: "get_task", input: { taskId: "aaa1" } });
            opts.onEvent({ type: "tool-result", id: "t1", isError: false });
            throw new ClaudeCliError("not-logged-in", "x");
        };
        await chat.send("look");
        const messages = store.getSnapshot().messages;
        expect(messages[1]).toMatchObject({ role: "tool", text: "get_task aaa1", state: "done" });
        expect(messages[2]).toMatchObject({ role: "error" });
        expect(messages[2].text).toMatch(/not logged in/);
    });

    test("a quota failure makes the next message wait instead of failing the same way", async () => {
        script = () => {
            throw new ClaudeCliError("quota", "usage limit");
        };
        await chat.send("a");
        expect(ClaudeClient.quotaBlockedUntil()).toBeGreaterThan(Date.now());
        await chat.send("b");
        expect(runs).toHaveLength(1);
        expect(store.getSnapshot().messages.at(-1)?.text).toMatch(/usage limit was reached/);
        // A cooldown of this process only: reset so nothing else is affected.
        (ClaudeClient as unknown as { blockedUntil: number }).blockedUntil = 0;
    });

    test("when Claude no longer knows the session, a new one is started once", async () => {
        await chat.send("one");
        let calls = 0;
        script = (opts) => {
            if (calls++ === 0) throw new ClaudeCliError("failed", "No conversation found with session ID x");
            opts.onEvent({ type: "text-delta", text: "again" });
        };
        await chat.send("two");
        expect(runs.slice(1).map((r) => (r.args.includes("--resume") ? "resume" : "new"))).toEqual(["resume", "new"]);
        expect(texts()).toContain("note:Claude lost the earlier conversation; starting a new one.");
    });

    test("/undo and /new are the chat's own: nothing is sent to Claude", async () => {
        await chat.send("/undo");
        expect(runs).toHaveLength(0);
        expect(texts()).toEqual(["note:Nothing to undo."]);
        await chat.send("/new");
        expect(runs).toHaveLength(0);
        expect(texts()).toEqual([]);
    });

    describe("consent", () => {
        test("off until the user allows it, once; a no is remembered", async () => {
            setAgent({ enabled: false, consentAsked: false });
            const asked: string[] = [];
            dialogBridge.setConfirmOpener((dialog, resolve) => {
                asked.push(dialog.choices.map((c) => c.label).join("/"));
                resolve(0);
            });
            await chat.send("hello");
            await chat.send("hello again");
            expect(runs).toHaveLength(0);
            // Asked once, with the safe answer first.
            expect(asked).toEqual(["Don't allow/Allow"]);
            expect(texts().filter((t) => t.startsWith("note:Claude is switched off"))).toHaveLength(2);
            expect(getAgentSettings()).toMatchObject({ enabled: false, consentAsked: true });
        });

        test("a refused message stays in the chat next to the reason, never lost", async () => {
            setAgent({ enabled: false, consentAsked: false });
            dialogBridge.setConfirmOpener((_dialog, resolve) => resolve(0));
            await chat.send("fix my titles");
            expect(texts().slice(0, 2)).toEqual([
                "user:fix my titles",
                expect.stringMatching(/^note:Claude is switched off/),
            ]);
            expect(store.getSnapshot().busy).toBe(false);
        });

        test("allowing it is stored, and the message goes through", async () => {
            setAgent({ enabled: false, consentAsked: false });
            dialogBridge.setConfirmOpener((_dialog, resolve) => resolve(1));
            await chat.send("hello");
            expect(runs).toHaveLength(1);
            expect(getAgentSettings()).toMatchObject({ enabled: true, consentAsked: true });
        });

        test("nobody to ask is not consent, and nothing is stored", async () => {
            setAgent({ enabled: false, consentAsked: false });
            await chat.send("hello");
            expect(runs).toHaveLength(0);
            expect(getAgentSettings()).toMatchObject({ enabled: false, consentAsked: false });
        });
    });

    test("undo reverts Claude's last change from the chat", async () => {
        const task = makeTrack("bbb2", "Other");
        installWorld([task]);
        task.setMetadataOverride({ year: 2000 }, { actor: "agent" });
        agentJournal.record({
            tool: "x",
            label: "set year",
            checks: [{ taskId: "bbb2", revisionAfter: task.getRevision() }],
            restore: () => task.restoreMetadataOverride({}),
        });
        await chat.send("/undo");
        expect(task.getAttributes()?.metadataOverride).toEqual({});
        expect(texts()).toEqual(["note:Undone: set year"]);
    });
});

describe("the MCP round trip through a real process", () => {
    test("a stand-in CLI reads the config, takes its token from the environment and uses the tools", async () => {
        const task = makeTrack("rt1", "Round Trip (Official Video)");
        installWorld([task]);
        const runtime = new AgentRuntime();
        const { turn, token } = await runtime.beginTurn();
        const configPath = path.join(process.env.TEMP ?? "/tmp", `fake-mcp-${Date.now()}.json`);
        fs.writeFileSync(configPath, buildMcpConfig(runtime.url));
        const events: AgentCliEvent[] = [];
        try {
            await runAgentCli({
                command: process.execPath,
                args: [FAKE_CLAUDE, "--session-id", "s-1", "--mcp-config", configPath],
                prompt: "please look at task rt1",
                token,
                signal: turn.signal,
                onEvent: (e) => events.push(e),
                timeoutMs: 20_000,
            });
        } finally {
            fs.rmSync(configPath, { force: true });
            runtime.endTurn(token);
            await runtime.stop();
        }
        expect(events.find((e) => e.type === "session")).toEqual({ type: "session", sessionId: "s-1" });
        const said = events
            .filter((e) => e.type === "text-delta")
            .map((e) => (e as { text: string }).text)
            .join("");
        expect(said).toMatch(/I see \d+ tools/);
        expect(events.find((e) => e.type === "tool-use")).toMatchObject({ name: "get_task", input: { taskId: "rt1" } });
        expect(events.at(-1)).toMatchObject({ type: "result", ok: true });
        // The write the stand-in made through the server went through the real tool.
        expect(task.getAttributes()?.metadataOverride).toEqual({ trackName: "Fixed by the fake" });
        expect(agentJournal.last()?.label).toMatch(/set_metadata_override/);
    });

    test("a CLI that fails is reported, and one that is not installed too", async () => {
        const signal = new AbortController().signal;
        await expect(
            runAgentCli({
                command: "definitely-not-a-claude-binary",
                args: [],
                prompt: "x",
                token: "t",
                signal,
                onEvent: () => {},
            })
        ).rejects.toMatchObject({ code: "not-installed" });
        await expect(
            runAgentCli({
                command: process.execPath,
                args: ["-e", "process.stderr.write('Not logged in'); process.exit(1)"],
                prompt: "x",
                token: "t",
                signal,
                onEvent: () => {},
            })
        ).rejects.toMatchObject({ code: "not-logged-in" });
    });

    test("aborting kills the process", async () => {
        const controller = new AbortController();
        const started = runAgentCli({
            command: process.execPath,
            args: ["-e", "setTimeout(() => {}, 60000)"],
            prompt: "x",
            token: "t",
            signal: controller.signal,
            onEvent: () => {},
        });
        setTimeout(() => controller.abort(), 100);
        await expect(started).rejects.toMatchObject({ code: "aborted" });
    });
});

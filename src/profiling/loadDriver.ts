// Synthetic activity for the performance scenarios. Never loaded in production (only `profiledEntry.tsx`
// imports it).
//
// Why: the costly paths of a long run (every task notifying while a run is going, a flood of log lines, the
// session being saved again and again) need a network, accounts and minutes of real downloads to trigger. This
// reproduces their *shape* offline and deterministically: the harness writes `{ action: "start", ... }` to the
// file named by GOBLIN_PROFILE_CONTROL (steps `startLoad` / `stopLoad`), and this module then changes the
// status of some tasks and writes log lines on a fixed tick, through the same public APIs the real services use.

import fs from "node:fs";
import { TaskOrchestrator } from "../base/task/orchestrator";
import { StatusType } from "../base/task/task-status";
import { globalLogger } from "../base/logger/logger";
import { chatStore } from "../flows/musicDownloadFlow/agent/chatStore";

interface LoadOptions {
    tasksPerTick?: number;
    tickMs?: number;
    logsPerTick?: number;
    logLevel?: "debug" | "info" | "warn";
    chatWordsPerTick?: number;
}

const POLL_MS = 100;

export function startLoadDriver(): void {
    const control = process.env["GOBLIN_PROFILE_CONTROL"];
    if (!control) return;

    const logger = globalLogger.createChild({ service: "LoadDriver" });
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastRaw = "";
    let tick = 0;
    let cursor = 0;

    let chatStreaming = false;
    const stop = (): void => {
        if (timer) clearInterval(timer);
        timer = undefined;
        if (chatStreaming) chatStore.setBusy(false);
        chatStreaming = false;
    };

    const start = (options: LoadOptions): void => {
        stop();
        const tasksPerTick = options.tasksPerTick ?? 0;
        const logsPerTick = options.logsPerTick ?? 0;
        const level = options.logLevel ?? "debug";
        const chatWordsPerTick = options.chatWordsPerTick ?? 0;
        if (chatWordsPerTick > 0) {
            // An answer being written: the chat is busy and text keeps arriving in small pieces.
            chatStreaming = true;
            chatStore.addUser("Write something long");
            chatStore.setBusy(true);
        }
        timer = setInterval(() => {
            tick++;
            if (chatWordsPerTick > 0) {
                // Markdown, like a real answer: a list item with a bold lead now and then.
                const table =
                    tick === 4
                        ? "\n\n| Tool | Kind |\n|---|---|\n| list_tasks | read |\n| set_override | write |\n\n"
                        : tick === 6
                          ? "\n\n| Tool | Resource | What I get |\n|---|---|---|\n| list_tasks | Tasks (tracks, albums) | id, title, state |\n\n"
                          : "";
                const item = table || (tick % 8 === 0 ? `\n- **item ${tick}**: ` : "");
                // A tool call with its raw input and answer, so the "details" of a tool line can be looked at.
                if (tick === 2)
                    chatStore.addTool("load-tool", "get_task task:3d6da40a5c5c", { taskId: "task:3d6da40a5c5c" });
                if (tick === 3) {
                    chatStore.finishTool("load-tool", false, '{"revision":42,"title":"Toc toc"}');
                }
                chatStore.appendAssistant(
                    item + Array.from({ length: chatWordsPerTick }, (_, i) => `word${tick}-${i} `).join("")
                );
            }
            if (tasksPerTick > 0) {
                const tasks = TaskOrchestrator.getInstance().getTasks();
                for (let i = 0; i < tasksPerTick && tasks.length > 0; i++) {
                    const task = tasks[cursor++ % tasks.length]!;
                    // The kind of change a running download makes: a new message and a progress value.
                    task.getStatus().update({
                        type: StatusType.Processing,
                        message: `Downloading ${tick}`,
                        progress: tick % 100,
                    });
                }
            }
            for (let i = 0; i < logsPerTick; i++) {
                logger[level](`[load] line ${tick}.${i} size=${12345 + i}KiB speed=1.2MiB/s eta=00:0${i % 10}`);
            }
        }, options.tickMs ?? 250);
    };

    const poll = setInterval(() => {
        let raw: string;
        try {
            raw = fs.readFileSync(control, "utf-8");
        } catch {
            return; // no command yet
        }
        if (raw === lastRaw) return;
        lastRaw = raw;
        try {
            const command = JSON.parse(raw) as { action: "start" | "stop" } & LoadOptions;
            if (command.action === "start") start(command);
            else stop();
        } catch {
            /* half-written file: the next poll sees the whole one */
            lastRaw = "";
        }
    }, POLL_MS);
    poll.unref();
}

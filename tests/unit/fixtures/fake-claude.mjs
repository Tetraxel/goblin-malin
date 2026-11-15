// A stand-in for the `claude` CLI, for the MCP round-trip test. It does what the real one does with the app's
// server: reads the MCP config file named by --mcp-config, takes the bearer token from the environment variable the
// config names, and talks to the server over HTTP. Then it prints `stream-json` lines like the real CLI.
import fs from "node:fs";

const args = process.argv.slice(2);
const configPath = args[args.indexOf("--mcp-config") + 1];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const server = config.mcpServers.goblin;
const token = process.env[/\$\{(\w+)\}/.exec(server.headers.Authorization)[1]];
const prompt = fs.readFileSync(0, "utf8");

async function rpc(method, params) {
    const res = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await res.json()).result;
}
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

const session = args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1];
out({ type: "system", subtype: "init", session_id: session });
await rpc("initialize", { protocolVersion: "2025-06-18" });
const { tools } = await rpc("tools/list");
out({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "I see " + tools.length + " tools. " } },
});

const taskId = /task (\S+)/.exec(prompt)?.[1];
if (taskId) {
    const got = await rpc("tools/call", { name: "get_task", arguments: { taskId } });
    const view = JSON.parse(got.content[0].text);
    out({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tu1", name: "mcp__goblin__get_task", input: { taskId } }] },
    });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: got.isError }] } });
    await rpc("tools/call", {
        name: "set_metadata_override",
        arguments: { taskId, revision: view.revision, patch: { trackName: "Fixed by the fake" } },
    });
    out({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Done." } },
    });
}
out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    session_id: session,
    total_cost_usd: 0.01,
    num_turns: 2,
});

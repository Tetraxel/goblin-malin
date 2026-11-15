import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

/**
 * The text of `docs/agent-tools.md`, generated from the agent tool registry and formatted by Prettier with the
 * repo's own settings. Shared by `yarn run agent:tools --write` and the unit test that fails when the committed file
 * is out of date, so both compare exactly the same text.
 */

export const AGENT_TOOLS_DOC_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "docs",
    "agent-tools.md"
);

export async function loadAgentTools() {
    // The data folder is only needed so the logger can open its file: never the user's real one.
    process.env.GOBLIN_DATA_DIR ??= path.join(process.env.TEMP ?? "/tmp", "goblin-malin-agent-tools");
    const { registerAgentTools } = await import("../src/flows/musicDownloadFlow/agent/registerAgentTools");
    const { agentToolRegistry } = await import("../src/base/agent/agentToolRegistry");
    registerAgentTools();
    return agentToolRegistry.list();
}

export async function generateAgentToolsDoc(): Promise<string> {
    const { renderCatalogueDoc } = await import("../src/base/agent/catalogue");
    const tools = await loadAgentTools();
    const config = (await prettier.resolveConfig(AGENT_TOOLS_DOC_PATH)) ?? {};
    return prettier.format(renderCatalogueDoc(tools), { ...config, parser: "markdown" });
}

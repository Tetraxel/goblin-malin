import fs from "node:fs/promises";
import prettier from "prettier";
import { AGENT_TOOLS_DOC_PATH, generateAgentToolsDoc, loadAgentTools } from "./agentToolsDoc";

/**
 * Prints the chat agent's tool catalogue, generated from the tool registry.
 *
 *   yarn run agent:tools                 a table for the terminal
 *   yarn run agent:tools --md            the table as markdown
 *   yarn run agent:tools --json          everything a tool declares except its code
 *   yarn run agent:tools --kind write    only tools of one kind (read | write | confirm)
 *   yarn run agent:tools --write         refresh docs/agent-tools.md
 */

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const kindIndex = args.indexOf("--kind");
const kind = kindIndex === -1 ? undefined : args[kindIndex + 1];

if (kind !== undefined && !["read", "write", "confirm"].includes(kind)) {
    console.error(`--kind must be read, write or confirm (got "${kind}")`);
    process.exit(1);
}

const { catalogueRows, renderCatalogueJson, renderCatalogueMarkdown, renderCatalogueText } =
    await import("../src/base/agent/catalogue");
const filter = { kind: kind as "read" | "write" | "confirm" | undefined };

if (flag("write")) {
    await fs.writeFile(AGENT_TOOLS_DOC_PATH, await generateAgentToolsDoc(), "utf8");
    console.log(`Wrote ${AGENT_TOOLS_DOC_PATH}`);
} else {
    const tools = await loadAgentTools();
    if (flag("json")) console.log(renderCatalogueJson(tools, filter));
    else if (flag("md")) {
        const md = renderCatalogueMarkdown(catalogueRows(tools, filter));
        console.log((await prettier.format(md, { parser: "markdown", printWidth: 120 })).trimEnd());
    } else console.log(renderCatalogueText(catalogueRows(tools, filter)));
}
// The tools pull in the whole app (timers, a logger): end the process instead of waiting for them.
process.exit(0);

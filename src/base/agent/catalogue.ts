import { type AgentToolDefinition, type AgentToolKind } from "./agentTool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AgentToolDefinition<any>;

export type CatalogueRow = {
    name: string;
    kind: AgentToolKind;
    locks: string;
    undoable: boolean;
    confirms: boolean;
    inputs: string;
    summary: string;
};

export const CATALOGUE_COLUMNS = ["Tool", "Kind", "Locks", "Undoable", "Confirms", "Inputs", "What it does"] as const;

/** The input names of a tool; an optional one ends with `?`. */
export function describeInputs(tool: AnyTool): string {
    const required = new Set(tool.input.required ?? []);
    const names = Object.keys(tool.input.properties ?? {});
    return names.length === 0 ? "—" : names.map((n) => (required.has(n) ? n : `${n}?`)).join(", ");
}

/** One row per tool, optionally only the tools of one kind. This is the only place a tool is turned into a row. */
export function catalogueRows(tools: readonly AnyTool[], filter: { kind?: AgentToolKind } = {}): CatalogueRow[] {
    return tools
        .filter((t) => !filter.kind || t.kind === filter.kind)
        .map((t) => ({
            name: t.name,
            kind: t.kind,
            locks: t.locks,
            undoable: t.undoable,
            confirms: t.kind === "confirm",
            inputs: describeInputs(t),
            summary: t.summary,
        }));
}

function cells(row: CatalogueRow): string[] {
    return [
        row.name,
        row.kind,
        row.locks,
        row.undoable ? "yes" : "no",
        row.confirms ? "yes" : "no",
        row.inputs,
        row.summary,
    ];
}

/** The table for a terminal: aligned columns, no markup. */
export function renderCatalogueText(rows: readonly CatalogueRow[]): string {
    const table = [[...CATALOGUE_COLUMNS], ...rows.map(cells)];
    const widths = CATALOGUE_COLUMNS.map((_, i) => Math.max(...table.map((r) => r[i].length)));
    return table.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ")).join("\n");
}

const escapeCell = (text: string): string => text.replace(/\|/g, "\\|");

/** The table as markdown (a header row and one row per tool). Prettier aligns it when the doc is written. */
export function renderCatalogueMarkdown(rows: readonly CatalogueRow[]): string {
    const head = `| ${CATALOGUE_COLUMNS.join(" | ")} |`;
    const rule = `| ${CATALOGUE_COLUMNS.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => {
        const c = cells(r);
        c[0] = `\`${c[0]}\``;
        return `| ${c.map(escapeCell).join(" | ")} |`;
    });
    return [head, rule, ...body].join("\n");
}

/** The catalogue for scripts: everything a tool declares except its code. */
export function renderCatalogueJson(tools: readonly AnyTool[], filter: { kind?: AgentToolKind } = {}): string {
    const out = tools
        .filter((t) => !filter.kind || t.kind === filter.kind)
        .map((t) => ({
            name: t.name,
            summary: t.summary,
            kind: t.kind,
            locks: t.locks,
            undoable: t.undoable,
            confirms: t.kind === "confirm",
            input: t.input,
            ...(t.example ? { example: t.example } : {}),
        }));
    return JSON.stringify(out, null, 2);
}

/**
 * The full reference, as markdown: the table, then one section per tool with its input schema and an example.
 * The text of `docs/agent-tools.md` (a unit test fails when the committed file is not exactly this, formatted).
 */
export function renderCatalogueDoc(tools: readonly AnyTool[]): string {
    const lines: string[] = [
        "# Agent tools",
        "",
        "> **Generated** from the tool registry by `yarn run agent:tools --write`. Do not edit it by hand: a unit test fails when it is out of date.",
        "",
        "Every tool the chat agent can call, declared once with `defineAgentTool` (see [P32](projects/p32/tasks.md)). The MCP server, the CLI's allowlist and this page all read the same registry.",
        "",
        "- **Kind**: `read` looks only; `write` changes the user's data through a named method; `confirm` always asks the user first.",
        "- **Locks**: what the call holds while it runs: nothing, the one task it names, or a set it picks itself.",
        "- **Inputs**: a name ending in `?` is optional.",
        "",
        renderCatalogueMarkdown(catalogueRows(tools)),
        "",
    ];
    for (const tool of tools) {
        lines.push(`## \`${tool.name}\``, "", tool.summary, "");
        lines.push(
            `Kind **${tool.kind}**, locks **${tool.locks}**, ${tool.undoable ? "can be undone" : "cannot be undone"}.`,
            ""
        );
        lines.push("Input:", "", "```json", JSON.stringify(tool.input, null, 2), "```", "");
        if (tool.example) lines.push("Example:", "", "```json", JSON.stringify(tool.example, null, 2), "```", "");
    }
    return lines.join("\n");
}

import { getMusicSettings } from "../settings";
import { DEFAULT_CLAUDE_COMMAND, DEFAULT_CLAUDE_MODEL } from "../services/apis/claude-client";

export type AgentSettings = {
    enabled: boolean;
    consentAsked: boolean;
    model: string;
    /** Keep `agent.log`: everything said and every tool call, raw. */
    keepLog: boolean;
    /** The Claude CLI to run: shared with the Claude discovery provider, so there is one place to set it. */
    command: string;
};

/** The chat agent's settings as they are now. */
export function getAgentSettings(): AgentSettings {
    const settings = getMusicSettings();
    const agent = settings.agent ?? {
        enabled: false,
        consentAsked: false,
        model: DEFAULT_CLAUDE_MODEL,
        panelWidth: 42,
        keepLog: true,
    };
    const sharedCommand = settings.metadata.discoveryProviders.claude?.command;
    return {
        enabled: agent.enabled === true,
        consentAsked: agent.consentAsked === true,
        model: typeof agent.model === "string" && agent.model.trim() !== "" ? agent.model.trim() : DEFAULT_CLAUDE_MODEL,
        keepLog: agent.keepLog !== false,
        command:
            typeof sharedCommand === "string" && sharedCommand.trim() !== ""
                ? sharedCommand.trim()
                : DEFAULT_CLAUDE_COMMAND,
    };
}

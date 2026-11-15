import { globalLogger } from "#base/logger/logger";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { SettingsStore } from "#settings/settingsStore";
import { type ProviderConsent } from "#base/providerSettings";
import { getAgentSettings } from "./agentSettings";

const logger = globalLogger.createChild({ service: "AgentConsent" });

/**
 * What the user is told before the chat agent is ever used. Distinct from the discovery consent of Claude: that one
 * sends a track's title and artists to look it up; this one lets Claude READ and CHANGE the user's tasks.
 */
export const AGENT_CONSENT: ProviderConsent = {
    title: "Let Claude read and change your tasks?",
    message:
        "When you ask in the chat, Claude can look at your tasks and change them: fix titles and artists, pick or " +
        "reject a download source, add a link you give it, run a search again. It can also search the streaming " +
        "platforms for music (the app makes the search, with the words Claude chose) and add the links it finds " +
        "to your list as new tasks. It can start tasks (find their metadata, or download them), and it asks you " +
        "first before any download.\n\n" +
        "What is sent to Claude: the titles, artists, albums and links of the tasks it looks at, their sources, and " +
        "trimmed task logs (your user name and home folder are hidden). It cannot read your files, run commands or " +
        "browse the web, and it never saves a file to your music folder: you do that in the app.\n\n" +
        "It runs the Claude Code CLI installed on this computer, with your own Claude account: every message uses " +
        "part of your plan's usage. Claude Code keeps the conversation in its own session files on this computer.\n\n" +
        "A change to a task's metadata, sources or links can be undone (/undo in the chat), and a batch is shown to " +
        "you before it is applied. Starting tasks, searching again, archiving and rejecting a download that is in " +
        "progress cannot be undone that way: archived tasks come back from the Archive window.\n\n" +
        "Everything said in the chat and every tool call are written to agent.log in the app's data folder (you can " +
        "turn that off in Settings), and the last conversation is kept there too, so you can reopen it from the chat. Each launch " +
        "starts empty: reopening it resumes Claude's session and uses your plan.\n\n" +
        "Change this anytime in Settings.",
};

// Dismissed with Esc: not an answer, nothing is stored, but do not re-ask within this launch.
let dismissedThisSession = false;
let inFlight: Promise<boolean> | undefined;

/** Whether the agent may be used now: switched on, or the user just said yes. Asks once (a "no" is remembered). */
export function ensureAgentConsent(): Promise<boolean> {
    const settings = getAgentSettings();
    if (settings.enabled) return Promise.resolve(true);
    if (settings.consentAsked || dismissedThisSession) return Promise.resolve(false);
    if (inFlight) return inFlight;

    inFlight = (async () => {
        // The safe answer first: a stray Enter never gives Claude access.
        const answer = await dialogBridge.confirm({
            title: AGENT_CONSENT.title,
            message: AGENT_CONSENT.message,
            choices: [
                { label: "Don't allow", tone: "muted" },
                { label: "Allow", tone: "success" },
            ],
            accent: "#d97757",
        });
        if (answer === null) {
            logger.info("Agent consent dialog dismissed without an answer");
            dismissedThisSession = true;
            return false;
        }
        const allowed = answer === 1;
        logger.info(allowed ? "User allowed the chat agent" : "User declined the chat agent");
        SettingsStore.getInstance().patchMusicSettings({ agent: { enabled: allowed, consentAsked: true } });
        return allowed;
    })().finally(() => {
        inFlight = undefined;
    });
    return inFlight;
}

/** Tests only. */
export function resetAgentConsentForTesting(): void {
    dismissedThisSession = false;
    inFlight = undefined;
}

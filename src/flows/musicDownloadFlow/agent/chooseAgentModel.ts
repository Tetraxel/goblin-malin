import { dialogBridge } from "#base/bridges/dialogBridge";
import { SettingsStore } from "#settings/settingsStore";
import { getAgentSettings } from "./agentSettings";

/** The models the chat offers. (The largest ones are not worth their cost for fixing tags and finding links.) */
export const AGENT_MODELS = ["haiku", "sonnet", "opus"] as const;

/** What each model is for, in one line (shown in the chooser). */
export const AGENT_MODEL_NOTES: Record<(typeof AGENT_MODELS)[number], string> = {
    haiku: "Fastest, and the lightest on your plan's usage. Fine for simple fixes.",
    sonnet: "Balanced: a good default for most requests.",
    opus: "More careful on hard or ambiguous requests. Uses more of your plan.",
};

/**
 * Asks which Claude model the chat should use, and saves the answer in Settings. Only meant for a conversation that
 * has not started: Claude Code keeps one model per session. Resolves the chosen model, or undefined when the dialog
 * was dismissed (or nobody is there to answer).
 */
export async function chooseAgentModel(accent: string): Promise<string | undefined> {
    const current = getAgentSettings().model;
    const answer = await dialogBridge.choose({
        title: "Claude model for the chat",
        intro: "It answers every message of this conversation. Change it now, before the first message.",
        accent,
        // The cursor starts on the model in use.
        initialIndex: Math.max(0, AGENT_MODELS.indexOf(current as (typeof AGENT_MODELS)[number])),
        items: AGENT_MODELS.map((model) => ({
            label: model === current ? `${model}  (current)` : model,
            detail: [AGENT_MODEL_NOTES[model]],
        })),
    });
    if (!answer || !("index" in answer)) return undefined;
    const model = AGENT_MODELS[answer.index];
    if (!model) return undefined;
    if (model !== current) SettingsStore.getInstance().patchMusicSettings({ agent: { model } });
    return model;
}

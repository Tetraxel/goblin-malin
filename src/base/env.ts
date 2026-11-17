import { type Task } from "./task/task";
import { type Logger } from "./logger/logger";
import { EnvironmentError } from "#exceptions/EnvironmentError";
import { type SetupWizardConfig } from "./setupWizard";
import { saveEnvVar, saveEnvVarsGroup } from "#utils/envFile";
import { SettingsStore } from "#settings/settingsStore";
import { dialogBridge } from "./bridges/dialogBridge";
import { appSecrets } from "./appSecrets";

/** How long a closed setup wizard is remembered, so a batch of tracks is not asked track by track. */
const CLOSED_SETUP_MEMORY_MS = 10 * 60_000;
/** Providers whose wizard was closed, with what the user was asked about it. Keyed `<type>:<provider>`. */
const closedSetups = new Map<string, { at: number; error: unknown; answered: Promise<void> }>();
/** The wizard open now for a provider, shared by every task that needs it. */
const wizardsInFlight = new Map<string, Promise<Record<string, string>>>();

/** Forgets which setup wizards were closed (for tests: the memory is per run of the app). */
export function forgetClosedSetups(): void {
    closedSetups.clear();
}

export class Env {
    protected task: Task;
    protected logger: Logger;

    constructor(task: Task, logger: Logger) {
        this.task = task;
        this.logger = logger.createChild({
            service: this.constructor.name,
            task: this.task,
        });
    }

    public async getVariable(
        key: string,
        options: {
            defaultValue?: string;
            description?: string;
            hint?: string;
        } = {}
    ): Promise<string> {
        try {
            const value = appSecrets.get(key);
            if (value === undefined) {
                throw new EnvironmentError(key);
            }
            return value;
        } catch {
            const value = await this.task.getPrompt().askInput({
                status: `Missing env key ${key}`,
                title: `Missing environment variable '${key}'`,
                message: (options?.description ? `${options?.description}\n\n` : "") + "Please provide a value:",
                defaultValue: options.defaultValue,
                hint: options.hint ? options.hint : "Enter value…",
            });

            await this.saveToEnvFile(key, value);
            appSecrets.set(key, value);

            return value;
        }
    }

    public async getVariablesWithWizard(config: SetupWizardConfig): Promise<Record<string, string>> {
        // With modes, the fields to fill are the chosen mode's (the first one when nothing was chosen yet).
        const modes = config.modes;
        const modeEnvVar = config.modeEnvVar;
        const mode =
            modes && modeEnvVar
                ? (modes.find((m) => m.id === (appSecrets.get(modeEnvVar) ?? modes[0].id)) ?? modes[0])
                : undefined;
        const fields = mode ? mode.fields : config.fields;

        if (fields.every((f) => appSecrets.get(f.envVar))) {
            // Everything is already known: no wizard.
            return {
                ...(mode && modeEnvVar ? { [modeEnvVar]: mode.id } : {}),
                ...Object.fromEntries(fields.map((f) => [f.envVar, appSecrets.get(f.envVar)!])),
            };
        }

        const values = await this.askWizard(config);
        await this.persistWizardValues(config, values);
        for (const [key, value] of Object.entries(values)) {
            appSecrets.set(key, value);
        }
        return values;
    }

    /** Writes what the wizard collected (the mode choice included) to the `.env` file; empty values are skipped. */
    private async persistWizardValues(config: SetupWizardConfig, values: Record<string, string>): Promise<void> {
        const nonEmpty = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
        try {
            if (config.envSection && Object.keys(nonEmpty).length > 0) {
                await saveEnvVarsGroup(nonEmpty, config.envSection);
            } else {
                for (const [key, value] of Object.entries(nonEmpty)) {
                    await saveEnvVar(key, value);
                }
            }
            this.logger.info(`Saved wizard vars to .env file.`);
        } catch (error) {
            this.logger.error(`Failed to save wizard vars to .env file:`, { error });
            throw new Error(`Could not persist environment variables to .env file`);
        }
    }

    /**
     * Shows the setup wizard for a provider, once for everyone who needs it: tracks that need the same provider's
     * credentials while it is open share its answer, and after it was closed they fail at once instead of opening it
     * again (and asking to turn the provider off again) for each of them. The memory lasts
     * {@link CLOSED_SETUP_MEMORY_MS}, so a later try, by hand, offers the wizard again.
     */
    private async askWizard(config: SetupWizardConfig): Promise<Record<string, string>> {
        const key =
            config.providerKey && config.providerType ? `${config.providerType}:${config.providerKey}` : undefined;
        if (!key) return this.showWizard(config);

        const closed = closedSetups.get(key);
        if (closed && Date.now() - closed.at < CLOSED_SETUP_MEMORY_MS) {
            await closed.answered;
            throw closed.error;
        }
        let run = wizardsInFlight.get(key);
        if (!run) {
            run = this.showWizard(config, key).finally(() => wizardsInFlight.delete(key));
            wizardsInFlight.set(key, run);
        }
        return run;
    }

    private async showWizard(config: SetupWizardConfig, key?: string): Promise<Record<string, string>> {
        try {
            return await this.task.getPrompt().askSetupWizard(config);
        } catch (error) {
            const answered = this.offerToDisableProvider(config).catch((offerError) => {
                this.logger.warn("Could not turn the provider off", { error: offerError });
            });
            if (key) closedSetups.set(key, { at: Date.now(), error, answered });
            await answered;
            throw error;
        }
    }

    /**
     * The setup was closed without being filled in: this track's step fails, and the provider stays on. Closing a
     * window is not a decision to switch a provider off for good (a slip of Esc used to do it, silently: no wizard was
     * ever offered again), so that is asked, with "keep it on" as the first button.
     */
    private async offerToDisableProvider(config: SetupWizardConfig): Promise<void> {
        if (!config.providerKey || !config.providerType) return;
        const answer = await dialogBridge.confirm({
            title: `Turn off ${config.title}?`,
            message:
                "The setup was closed without credentials, so this track could not use it. " +
                "Turn it off in Settings so it is not asked again? You can turn it back on there at any time.",
            choices: [
                { label: "Keep it on", tone: "primary" },
                { label: "Turn it off", tone: "danger" },
            ],
        });
        if (answer !== 1) return;
        SettingsStore.getInstance().patchMusicSettings({
            [config.providerType]: { providers: { [config.providerKey]: { enabled: false } } },
        });
        this.logger.info(`Disabled provider '${config.providerKey}' in settings.`);
    }

    private async saveToEnvFile(key: string, value: string): Promise<void> {
        try {
            await saveEnvVar(key, value);
            this.logger.info(`Saved ${key} to .env file.`);
        } catch (error) {
            this.logger.error(`Failed to save ${key} to .env file:`, { error });
            throw new Error(`Could not persist environment variable to .env file`);
        }
    }
}

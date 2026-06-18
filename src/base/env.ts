import { Task } from "./task/task";
import { Logger } from "./logger/logger";
import { EnvironmentError } from "#exceptions/EnvironmentError";
import { SetupWizardConfig } from "./setupWizard";
import { saveEnvVar, saveEnvVarsGroup } from "#utils/envFile";
import { SettingsStore } from "#settings/settingsStore";

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
            const value = process.env[key];
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
            process.env[key] = value;

            return value;
        }
    }

    public async getVariablesWithWizard(config: SetupWizardConfig): Promise<Record<string, string>> {
        // Mode-aware path
        if (config.modes && config.modeEnvVar) {
            const modeEnvVar = config.modeEnvVar;
            const chosenModeId = process.env[modeEnvVar] ?? config.modes[0].id;
            const activeMode = config.modes.find((m) => m.id === chosenModeId) ?? config.modes[0];

            const missingModeFields = activeMode.fields.filter((f) => !process.env[f.envVar]);

            if (missingModeFields.length === 0) {
                // All fields already in env; return them without showing wizard
                return {
                    [modeEnvVar]: activeMode.id,
                    ...Object.fromEntries(activeMode.fields.map((f) => [f.envVar, process.env[f.envVar]!])),
                };
            }

            // Show wizard
            let values: Record<string, string>;
            try {
                values = await this.task.getPrompt().askSetupWizard(config);
            } catch (error) {
                this.persistProviderDisabled(config);
                throw error;
            }

            // Persist modeEnvVar + mode fields
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
            for (const [key, value] of Object.entries(values)) {
                process.env[key] = value;
            }
            return values;
        }

        // Non-modes path (back-compat)
        const missing = config.fields.filter((f) => !process.env[f.envVar]);

        if (missing.length > 0) {
            let values: Record<string, string>;
            try {
                values = await this.task.getPrompt().askSetupWizard(config);
            } catch (error) {
                this.persistProviderDisabled(config);
                throw error;
            }

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
            for (const [key, value] of Object.entries(values)) {
                process.env[key] = value;
            }
            return values;
        }

        return Object.fromEntries(config.fields.map((f) => [f.envVar, process.env[f.envVar]!]));
    }

    private persistProviderDisabled(config: SetupWizardConfig): void {
        if (!config.providerKey || !config.providerType) return;
        SettingsStore.getInstance().patchFlowSettings(this.task.getFlowId(), {
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

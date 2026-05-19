import { Task } from "./task/task";
import { Logger } from "./logger/logger";
import { EnvironmentError } from "../exceptions/EnvironmentError";
import { SetupWizardConfig } from "./setupWizard";
import { saveEnvVar, saveEnvVarsGroup } from "../utils/envFile";

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
        const missing = config.fields.filter((f) => !process.env[f.envVar]);

        if (missing.length > 0) {
            const values = await this.task.getPrompt().askSetupWizard(config);
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

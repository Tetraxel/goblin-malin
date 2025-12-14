import { Task } from "./task/task";
import { Logger } from "./logger/logger";
import { EnvironmentError } from "../exceptions/EnvironmentError";
import * as fs from "fs/promises";
import * as path from "path";

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
            hint?: string
        } = {}
    ): Promise<string> {
        try {
            const value = process.env[key]
            if (value === undefined) {
                throw new EnvironmentError(key);
            }
            return value;
        } catch (error) {
            const value = await this.task.getPrompt().askInput(
                {
                    status: `Missing env key ${key}`,
                    title: `Missing environment variable '${key}'`,
                    message: (options?.description ? `${options?.description}\n\n` : "") + "Please provide a value:",
                    defaultValue: options.defaultValue,
                    hint: options.hint ? options.hint : "Enter value...",
                }
            );

            await this.saveToEnvFile(key, value);
            process.env[key] = value;

            return value;
        }
    }


    private async saveToEnvFile(key: string, value: string): Promise<void> {
        const envPath = path.resolve(process.cwd(), ".env");

        try {
            const envContent = await fs.readFile(envPath, { encoding: "utf-8", flag: "w+" });

            const lines = envContent.split("\n").filter((line) => !line.startsWith("#"));
            const keyPattern = new RegExp(`^${key}=`, "i");
            const existingIndex = lines.findIndex(line => keyPattern.test(line.trim()));

            if (existingIndex !== -1) {
                this.logger.info(`Variable ${key} already exists in .env file, skipping.`);
                return;
            }

            const newEntry = `${key}=${value}`;
            const updatedContent = envContent.trim()
                ? `${envContent.trim()}\n${newEntry}\n` // append at the end
                : `${newEntry}\n`; // no content, set the content to the only variable

            await fs.writeFile(envPath, updatedContent, "utf-8");
            this.logger.info(`Successfully added ${key} to .env file.`);

        } catch (error) {
            this.logger.error(`Failed to save ${key} to .env file:`, { error });
            throw new Error(`Could not persist environment variable to .env file`);
        }
    }
}

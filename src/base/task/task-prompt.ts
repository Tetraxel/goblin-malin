import { StatusType, TaskStatus } from "./task-status";
import { SetupWizardConfig } from "../setupWizard";

export enum PromptType {
    Confirm = "confirm",
    Select = "select",
    Input = "input",
    SetupWizard = "setupWizard",
}

export enum PromptDisplayMode {
    Modal = "modal", // Fullscreen modal, blocking interaction with the rest of the UI
}

export interface BasePrompt {
    id: string;
    type: PromptType;
    status: string;
    title: string;
    message?: string;
    displayMode?: PromptDisplayMode;
}

export interface ConfirmPrompt extends BasePrompt {
    type: PromptType.Confirm;
    defaultValue?: boolean;
}

export interface SelectPrompt extends BasePrompt {
    type: PromptType.Select;
    options: { label: string; value: string }[];
}

export interface InputPrompt extends BasePrompt {
    type: PromptType.Input;
    status: string;
    title: string;
    message: string;
    defaultValue?: string;
    hint?: string;
}

export interface SetupWizardPrompt extends BasePrompt {
    type: PromptType.SetupWizard;
    config: SetupWizardConfig;
    resolve: (values: Record<string, string>) => void;
    reject: (reason?: unknown) => void;
}

export type UserPrompt = ConfirmPrompt | SelectPrompt | InputPrompt | SetupWizardPrompt;

export interface PendingPrompt<T = any> {
    prompt: UserPrompt;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

export class TaskPrompt {
    private id: string;
    private status: TaskStatus;
    private current: PendingPrompt | null = null;
    private notifySubscribers: () => void;

    public constructor(id: string, status: TaskStatus, notifyTaskSubscribers: () => void) {
        this.id = id
        this.status = status
        this.notifySubscribers = notifyTaskSubscribers;
    }

    public get() {
        return this.current?.prompt ?? null;
    }

    // async askConfirm(message: string, defaultValue = false): Promise<boolean> {
    //     const prompt: ConfirmPrompt = {
    //         id: `${this.id}-confirm-${Date.now()}`,
    //         type: PromptType.Confirm,
    //         message,
    //         defaultValue,
    //     };

    //     return this.requestUserInput<boolean>(prompt);
    // }

    // async askSelect(message: string, options: { label: string; value: string }[]): Promise<string> {
    //     const prompt: SelectPrompt = {
    //         id: `${this.id}-select-${Date.now()}`,
    //         type: PromptType.Select,
    //         message,
    //         options,
    //     };

    //     return this.requestUserInput<string>(prompt);
    // }

    async askInput(options: { status: string, title: string, message: string, defaultValue?: string, hint?: string }): Promise<string> {
        const prompt: InputPrompt = {
            id: `${this.id}-input-${Date.now()}`,
            type: PromptType.Input,
            ...options
        };

        return this.requestUserInput<string>(prompt);
    }

    async askSetupWizard(config: SetupWizardConfig): Promise<Record<string, string>> {
        return new Promise<Record<string, string>>((resolve, reject) => {
            const prompt: SetupWizardPrompt = {
                id: `${this.id}-wizard-${Date.now()}`,
                type: PromptType.SetupWizard,
                status: `⚙  Setup wizard: ${config.title}`,
                title: config.title,
                config,
                resolve,
                reject,
            };

            this.status.update({
                type: StatusType.PendingUserAction,
                message: prompt.status,
            });

            this.current = {
                prompt,
                resolve: resolve as (value: any) => void,
                reject,
            };

            this.notifySubscribers();
        });
    }

    // Generic method to request user input
    private async requestUserInput<T>(prompt: UserPrompt): Promise<T> {
        // Set status to pending
        this.status.update({
            type: StatusType.PendingUserAction,
            message: prompt.status,
        });

        // Create a promise that will be resolved when user responds
        return new Promise<T>((resolve, reject) => {
            this.current = {
                prompt,
                resolve: resolve as (value: any) => void,
                reject,
            };

            // Notify subscribers that a prompt is now active
            this.notifySubscribers();
        });
    }

    // Called by UI when user provides input
    resolvePrompt<T>(value: T): void {
        if (!this.current) {
            console.warn(`No pending prompt for task ${this.id}`);
            return;
        }

        const resolve = this.current.resolve;
        this.current = null;

        // Notify subscribers first (to update UI)
        this.notifySubscribers();

        // Clear pending status
        this.status.update({
            type: StatusType.Processing,
            message: "Continuing…",
        });

        // Resolve the promise last (this will continue task execution)
        resolve(value);
    }

    // Called by UI if user cancels
    cancelPrompt(error?: Error): void {
        if (!this.current) {
            return;
        }

        const reject = this.current.reject;
        this.current = null;

        // Notify subscribers first
        this.notifySubscribers();

        this.status.update({
            type: StatusType.Error,
            message: "Cancelled by user",
        });

        // Reject the promise last
        reject(error || new Error("User cancelled"));
    }

    // Check if task is waiting for user input
    isPendingUserInput(): boolean {
        return this.current !== null;
    }

    getCurrentPrompt(): UserPrompt | null {
        return this.current?.prompt || null;
    }
}
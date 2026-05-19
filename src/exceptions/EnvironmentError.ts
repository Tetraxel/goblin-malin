// EnvironmentError.ts
export class EnvironmentError extends Error {
    constructor(key: string) {
        super(`Environment variable ${key} is not set`);
        this.name = "EnvironmentError";
    }
}

/**
 * The credentials the app keeps for its providers (a Spotify client secret, a Soulseek password), read from the
 * `.env` file at start-up or typed in a setup wizard.
 *
 * They live here and not in `process.env`: every program the app starts (yt-dlp, ffmpeg, mpv, the package manager,
 * the Claude CLI) inherits the process environment, and none of them has any use for these. {@link appSecrets.adopt}
 * moves the keys the providers declare out of the environment once they are registered; a key a provider does not
 * declare (a variable the user's own tools expect, such as a proxy or a Claude API key) is left where it is.
 *
 * Reading falls back to `process.env`, so a credential the user set in their own environment still works.
 */
const store = new Map<string, string>();

export const appSecrets = {
    get(key: string): string | undefined {
        return store.get(key) ?? process.env[key];
    },

    /** Keeps `value` for the app only; it is never written to the environment the child programs inherit. */
    set(key: string, value: string): void {
        store.set(key, value);
        delete process.env[key];
    },

    delete(key: string): void {
        store.delete(key);
        delete process.env[key];
    },

    /** Moves these keys out of `process.env` into the store (those that are set there). */
    adopt(keys: Iterable<string>): void {
        for (const key of keys) {
            const value = process.env[key];
            if (value === undefined) continue;
            store.set(key, value);
            delete process.env[key];
        }
    },

    /** The values as an environment object (what a function that reads `env[key]` expects): the store over `process.env`. */
    asEnv(): NodeJS.ProcessEnv {
        return new Proxy({} as NodeJS.ProcessEnv, {
            get: (_target, key) => (typeof key === "string" ? appSecrets.get(key) : undefined),
        });
    },

    /** Every key the store holds (to strip them from an environment a program is given). */
    keys(): string[] {
        return [...store.keys()];
    },

    /** Forgets everything (tests). */
    clear(): void {
        store.clear();
    },
};

/** The environment variables a setup wizard reads and writes: its fields, those of each mode, and the mode switch. */
export function wizardEnvKeys(config: {
    fields: readonly { envVar: string }[];
    modes?: readonly { fields: readonly { envVar: string }[] }[];
    modeEnvVar?: string;
}): string[] {
    return [
        ...config.fields.map((f) => f.envVar),
        ...(config.modes ?? []).flatMap((m) => m.fields.map((f) => f.envVar)),
        ...(config.modeEnvVar ? [config.modeEnvVar] : []),
    ];
}

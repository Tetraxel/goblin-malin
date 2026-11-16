import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

// Closing a setup wizard (Esc) fails the step. It used to switch the provider off in Settings for good, silently.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-wizard-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const { Env, forgetClosedSetups } = await import("#base/env");
const { SettingsStore } = await import("#settings/settingsStore");
const { dialogBridge } = await import("#base/bridges/dialogBridge");
const { globalLogger } = await import("#base/logger/logger");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
afterEach(() => {
    vi.restoreAllMocks();
    forgetClosedSetups();
});

const config = {
    title: "Spotify setup",
    providerKey: "spotify",
    providerType: "metadata" as const,
    description: [],
    fields: [{ envVar: "WIZARD_TEST_ID", label: "Client ID" }],
};

function envWithClosedWizard() {
    const task = { getPrompt: () => ({ askSetupWizard: () => Promise.reject(new Error("closed")) }) };
    return new Env(task as never, globalLogger);
}

describe("a setup wizard that was closed", () => {
    test("the step fails, and the provider stays on when the user says keep it on", async () => {
        const patch = vi.spyOn(SettingsStore.getInstance(), "patchMusicSettings");
        const asked = vi.spyOn(dialogBridge, "confirm").mockResolvedValue(0);

        await expect(envWithClosedWizard().getVariablesWithWizard(config)).rejects.toThrow("closed");

        expect(asked).toHaveBeenCalledTimes(1);
        expect(asked.mock.calls[0][0].choices[0].label).toBe("Keep it on");
        expect(patch).not.toHaveBeenCalled();
    });

    test("nobody to ask (no window) is not a yes", async () => {
        const patch = vi.spyOn(SettingsStore.getInstance(), "patchMusicSettings");
        // The real bridge with no UI mounted answers null.
        await expect(envWithClosedWizard().getVariablesWithWizard(config)).rejects.toThrow("closed");
        expect(patch).not.toHaveBeenCalled();
    });

    test("the provider is switched off only when the user chooses it", async () => {
        const patch = vi.spyOn(SettingsStore.getInstance(), "patchMusicSettings").mockImplementation(() => {});
        vi.spyOn(dialogBridge, "confirm").mockResolvedValue(1);

        await expect(envWithClosedWizard().getVariablesWithWizard(config)).rejects.toThrow("closed");

        expect(patch).toHaveBeenCalledWith({ metadata: { providers: { spotify: { enabled: false } } } });
    });

    test("a batch of tracks is shown the wizard, and asked about turning the provider off, once", async () => {
        const asked = vi.spyOn(dialogBridge, "confirm").mockResolvedValue(0);
        let shown = 0;
        const task = {
            getPrompt: () => ({
                askSetupWizard: async () => {
                    shown++;
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    throw new Error("closed");
                },
            }),
        };
        const envs = Array.from({ length: 5 }, () => new Env(task as never, globalLogger));

        // Some are waiting while the wizard is open, the rest come after it was closed.
        const during = envs.slice(0, 3).map((env) => env.getVariablesWithWizard(config));
        await Promise.allSettled(during);
        const after = envs.slice(3).map((env) => env.getVariablesWithWizard(config));

        for (const result of await Promise.allSettled([...during, ...after])) {
            expect(result.status).toBe("rejected");
        }
        expect(shown).toBe(1);
        expect(asked).toHaveBeenCalledTimes(1);
    });

    test("another provider's wizard is not affected by it", async () => {
        const asked = vi.spyOn(dialogBridge, "confirm").mockResolvedValue(0);
        await expect(envWithClosedWizard().getVariablesWithWizard(config)).rejects.toThrow("closed");
        const other = { ...config, providerKey: "soulseek", title: "Soulseek setup" };
        await expect(envWithClosedWizard().getVariablesWithWizard(other)).rejects.toThrow("closed");
        expect(asked).toHaveBeenCalledTimes(2);
    });
});

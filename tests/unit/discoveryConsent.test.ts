import { describe, test, expect, vi, beforeEach } from "vitest";

// Settings live in memory for these tests: the real store would write the developer's settings.json.
type Stored = Record<string, Record<string, boolean | string>>;
const state = vi.hoisted(() => ({ stored: {} as Record<string, Record<string, boolean | string>> }));

vi.mock("#flows/musicDownloadFlow/settings", () => ({
    getMusicSettings: () => ({ metadata: { discoveryProviders: state.stored } }),
}));

import { SettingsStore } from "#settings/settingsStore";
import { consentBridge, ConsentRequest } from "#base/bridges/consentBridge";
import { discoveryServiceRegistry } from "#flows/musicDownloadFlow/registries";
import { DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { ensureDiscoveryConsent, getUnansweredConsentKeys } from "#flows/musicDownloadFlow/utils/discoveryConsent";

class GatedService extends DiscoveryMetadataService {
    static readonly consent = { title: "Use gated?", message: "It sends data away." };
    async discoverFromUri() {
        return { tracks: [] };
    }
}
class OpenService extends DiscoveryMetadataService {
    async discoverFromUri() {
        return { tracks: [] };
    }
}

const patchMusicSettings = vi.spyOn(SettingsStore.getInstance(), "patchMusicSettings").mockImplementation((patch) => {
    const providers = (patch as { metadata: { discoveryProviders: Stored } }).metadata.discoveryProviders;
    for (const [k, value] of Object.entries(providers)) {
        state.stored[k] = { ...state.stored[k], ...value };
    }
});

// Keys are unique per test: "dismissed this session" is deliberately module state.
let n = 0;
let key: string;
let requests: ConsentRequest[];

beforeEach(() => {
    state.stored = {};
    requests = [];
    patchMusicSettings.mockClear();
    key = `gated${++n}`;
    discoveryServiceRegistry.register(key, GatedService as never);
    discoveryServiceRegistry.register(`open${n}`, OpenService as never);
    consentBridge.setOpener((req) => requests.push(req));
});

describe("ensureDiscoveryConsent", () => {
    test("providers without a declared consent are never asked", async () => {
        await expect(ensureDiscoveryConsent(`open${n}`)).resolves.toBe(true);
        expect(requests).toHaveLength(0);
    });

    test("an already-enabled provider is not asked", async () => {
        state.stored[key] = { enabled: true };
        await expect(ensureDiscoveryConsent(key)).resolves.toBe(true);
        expect(requests).toHaveLength(0);
    });

    test("allow enables the provider and remembers the answer", async () => {
        const answer = ensureDiscoveryConsent(key);
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        requests[0].allow();

        await expect(answer).resolves.toBe(true);
        expect(state.stored[key]).toEqual({ enabled: true, consentAsked: true });
    });

    test("deny disables the provider and is never asked again", async () => {
        const answer = ensureDiscoveryConsent(key);
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        requests[0].deny();

        await expect(answer).resolves.toBe(false);
        expect(state.stored[key]).toEqual({ enabled: false, consentAsked: true });
        await expect(ensureDiscoveryConsent(key)).resolves.toBe(false);
        expect(requests).toHaveLength(1);
    });

    test("dismissing stores nothing but does not nag again this session", async () => {
        const answer = ensureDiscoveryConsent(key);
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        requests[0].dismiss();

        await expect(answer).resolves.toBe(false);
        expect(patchMusicSettings).not.toHaveBeenCalled();
        await expect(ensureDiscoveryConsent(key)).resolves.toBe(false);
        expect(requests).toHaveLength(1);
    });

    test("many tasks asking at once share one dialog", async () => {
        const answers = [ensureDiscoveryConsent(key), ensureDiscoveryConsent(key), ensureDiscoveryConsent(key)];
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        requests[0].allow();

        await expect(Promise.all(answers)).resolves.toEqual([true, true, true]);
        expect(requests).toHaveLength(1);
    });

    test("different providers are asked one dialog at a time", async () => {
        const other = `gated-other${n}`;
        discoveryServiceRegistry.register(other, GatedService as never);

        const a = ensureDiscoveryConsent(key);
        const b = ensureDiscoveryConsent(other);
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].providerKey).toBe(key);

        requests[0].allow();
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1].providerKey).toBe(other);
        requests[1].deny();

        await expect(Promise.all([a, b])).resolves.toEqual([true, false]);
    });

    test("without a UI it declines without storing anything", async () => {
        consentBridge.setOpener(null);
        await expect(ensureDiscoveryConsent(key)).resolves.toBe(false);
        expect(patchMusicSettings).not.toHaveBeenCalled();
    });
});

describe("getUnansweredConsentKeys", () => {
    test("lists gated providers until they are enabled or answered", () => {
        expect(getUnansweredConsentKeys()).toContain(key);
        state.stored[key] = { enabled: false, consentAsked: true };
        expect(getUnansweredConsentKeys()).not.toContain(key);
    });
});

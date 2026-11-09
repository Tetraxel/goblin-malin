import { describe, expect, test } from "vitest";
import { isSetupComplete, type SetupWizardConfig } from "#base/setupWizard";
import { SpotifyService } from "#flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService";
import { buildFlowSettingsItems } from "#flows/musicDownloadFlow/buildFlowSettingsItems";
import { type MusicDownloadFlowSettings } from "#flows/musicDownloadFlow/settings";

const plain: SetupWizardConfig = {
    title: "Plain",
    description: [],
    fields: [
        { envVar: "T_USER", label: "USER" },
        { envVar: "T_OPTIONAL", label: "OPTIONAL", required: false },
    ],
};

const withModes: SetupWizardConfig = {
    title: "Modes",
    description: [],
    fields: [],
    modeEnvVar: "T_MODE",
    modes: [
        { id: "official", label: "Official", fields: [{ envVar: "T_ID", label: "ID" }] },
        { id: "scrape", label: "Scrape", fields: [] },
    ],
};

describe("isSetupComplete", () => {
    test("a wizard without modes needs every required field", () => {
        expect(isSetupComplete(plain, {})).toBe(false);
        expect(isSetupComplete(plain, { T_USER: "  " })).toBe(false);
        expect(isSetupComplete(plain, { T_USER: "me" })).toBe(true);
    });

    test("with modes, the active mode's fields count (first mode when none is chosen)", () => {
        expect(isSetupComplete(withModes, {})).toBe(false);
        expect(isSetupComplete(withModes, { T_ID: "abc" })).toBe(true);
        expect(isSetupComplete(withModes, { T_MODE: "official", T_ID: "abc" })).toBe(true);
    });

    test("a mode without fields is the limited option, never complete", () => {
        expect(isSetupComplete(withModes, { T_MODE: "scrape", T_ID: "abc" })).toBe(false);
    });
});

describe("Settings: provider benefits note (PROD-05)", () => {
    const rows = () =>
        buildFlowSettingsItems(
            {
                metadata: { providers: {}, discoveryProviders: {} },
                download: { providers: {} },
                collections: {},
            } as unknown as MusicDownloadFlowSettings,
            [{ key: "spotify", ctor: SpotifyService }],
            [],
            [],
            () => {}
        );
    const spotifyNotes = () =>
        rows().filter((i) => i.kind === "note" && i.text === SpotifyService.setupWizard.benefits);

    test("is shown while Spotify has no credentials", () => {
        const saved = { ...process.env };
        delete process.env.SPOTIFY_CLIENT_ID;
        delete process.env.SPOTIFY_CLIENT_SECRET;
        process.env.SPOTIFY_AUTH_MODE = "official";
        try {
            expect(spotifyNotes()).toHaveLength(1);
        } finally {
            process.env = saved;
        }
    });

    test("is shown in scrape mode, and gone once the credentials are set", () => {
        const saved = { ...process.env };
        try {
            process.env.SPOTIFY_AUTH_MODE = "scrape";
            expect(spotifyNotes()).toHaveLength(1);
            process.env.SPOTIFY_AUTH_MODE = "official";
            process.env.SPOTIFY_CLIENT_ID = "id";
            process.env.SPOTIFY_CLIENT_SECRET = "secret";
            expect(spotifyNotes()).toHaveLength(0);
        } finally {
            process.env = saved;
        }
    });
});

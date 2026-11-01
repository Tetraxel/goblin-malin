import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import { INTRO_CUES, OUTRO_CUES, SOUND_VOLUME } from "../../src/components/WelcomeModal/intro/introSounds";
import { buildMixGraph, mixFiles, MpvMix } from "../../src/utils/mpvMix";

describe("buildMixGraph", () => {
    it("gives each cue its own chain, in track order, then mixes them", () => {
        const graph = buildMixGraph([
            { file: "a.wav", at: 0 },
            { file: "b.wav", at: 1.5, gainDb: -6 },
        ]);
        const chains = graph.split(";");
        expect(chains).toHaveLength(5);
        expect(chains[0]).toBe("[aid1]anull[in0]");
        expect(chains[1]).toBe("[aid2]anull[in1]");
        expect(chains[2]).toMatch(/^\[in0\].*\[cue0\]$/);
        expect(chains[3]).toMatch(/^\[in1\].*volume=-6dB.*adelay=1500:all=1\[cue1\]$/);
        expect(chains[4]).toBe("[cue0][cue1]amix=inputs=2:normalize=0:duration=longest[ao]");
    });

    it("opens a reused file once and splits it", () => {
        const cues = [
            { file: "a.wav", at: 0 },
            { file: "b.wav", at: 1 },
            { file: "a.wav", at: 2 },
        ];
        expect(mixFiles(cues)).toEqual(["a.wav", "b.wav"]);
        const chains = buildMixGraph(cues).split(";");
        expect(chains[0]).toBe("[aid1]asplit=2[in0][in2]");
        expect(chains[1]).toBe("[aid2]anull[in1]");
    });

    it("applies a cue's own filter before trimming, and fades out at the trimmed end", () => {
        const graph = buildMixGraph([
            { file: "a.wav", at: 0, from: 0.5, duration: 2, fadeOut: 0.25, filter: "highpass=f=800" },
        ]);
        expect(graph).toContain("[in0]highpass=f=800,atrim=start=0.5:end=2.5,asetpts=PTS-STARTPTS");
        expect(graph).toContain("afade=t=out:st=1.75:d=0.25");
    });

    it("loops before anything else, so a filtered loop keeps its seams", () => {
        const graph = buildMixGraph([{ file: "a.wav", at: 0, loopSamples: 1000, filter: "asetrate=41625" }]);
        expect(graph).toContain("[in0]aloop=loop=-1:size=1000,asetrate=41625,atrim=start=0,");
    });

    it("leaves out what a cue doesn't ask for", () => {
        const graph = buildMixGraph([{ file: "a.wav", at: 0 }]);
        expect(graph).not.toContain("afade");
        expect(graph).not.toContain("stereotools");
    });
});

describe("intro sounds", () => {
    it("ship with the app", () => {
        for (const cue of [...INTRO_CUES, ...OUTRO_CUES]) expect(existsSync(cue.file), cue.file).toBe(true);
    });

    it("stay silent, without waiting, when audio is off", async () => {
        await expect(new MpvMix(INTRO_CUES, SOUND_VOLUME).started).resolves.toBeNull();
    });
});

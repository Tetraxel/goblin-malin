import { getAssetPath } from "#utils/appPaths";
import { MixCue } from "#utils/mpvMix";
import { FINALE, T } from "./introScene";
import { FETCH, PASTE, sceneStart } from "./tour";
import { COMPARE, DOWNLOAD, PREVIEW, SAVE } from "./tourSteps";

// The intro's soundtrack (see sfx.md). Every cue follows the scene's own timing constants,
// so retiming a step moves its sounds too. Everything melodic is in A (the sources are
// pitched there) and the music runs at 118 BPM, the tempo the preview step dances to.

export const SOUND_VOLUME = 50; // as the app's other sounds (App.tsx)

/** The song's length is 8:24, but it has faded to nothing by here: the app closes with it. */
export const OUTRO_SONG_END = 8 * 60 + 20;

const SOUNDS = {
    // Music
    idleArp: "KMRBI_RHXS_125_synth_arp_loop_chiptune_sugar_A#maj.wav",
    drums: "PMRW2_full_drum_loop_115_vintage.wav",
    heroTrack: "002_Full_Loop_122bpm_A#_-_80SW1_Zenhiser.wav",
    outro: "outro.mp3",
    // Awakening
    drone: "DroneDemonic_BW.12015.wav",
    dust: "MagicalTwinkle_S08CT.108.wav",
    glint: "ESM_Christmas_Notification_Positive_Bling_Chime_1_Game.wav",
    lids: "BlinkTwice_BW.59867.wav",
    lookLeft: "ESM_GT_cinematic_fx_UI_cartoon_bubble_swish_02.wav",
    lookRight: "ESM_GT_cinematic_fx_UI_cartoon_bubble_swish_03.wav",
    wink: "HYPER_POTIONS_fx_one_shot_treasure_get_09_C.wav",
    facePop: "BULLYFINGER_one_shot_kick_deep_chiptune_8bit.wav",
    sparks: "ESM_GB_fx_foley_one_shot_magspel_magic_star_victory_sparkles_airy_light.wav",
    scramble: "ESM_MG3_fx_powerups_digital_glitch_computer.wav",
    lockIn: "ESM_HCGUI_fx_soft_achievements_keys_arcade_high_synth_02.wav",
    dissolve: "ESM_PG_cinematic_fx_magic_collect_shimmer_reveal_particles_swell_01.wav",
    flightWhoosh: "BRS_SFX_Whoosh_Airy_Twinkle_Lite.wav",
    flightSlide: "FF_CRT_sfx_slip_fall_away_short.wav",
    boing: "FF_CRT_sfx_boing_three_eye_pop_low.wav",
    // Shared by the tour's steps
    wipe: "PSE_DDV1_FX_One_Shot_Glitch_UI_Interface_Swoosh_01.wav",
    captionBlips: "ESM_Text_Box_Typing_App_Button_Sci_Fi_Glitch_Morph_Mechanism_Texture_Futuristic.wav",
    voice: "ESM_MG3_fx_animal_dog_squeaky_cartoon_animal_01.wav",
    // Step 1
    keyPress: "ComputerKeyboard_S08OF.121.wav", // two strikes 0.1s apart: the modifier, then the letter
    shockwave: "SonarPingSpace_BWU11.256.wav",
    spotifyZap: "STCR2_MTA_FX_One_Shot_Zap_Admirable.wav",
    youtubeZap: "AFP2_Zap_20.wav",
    rowLand: "ESM_Bubble_Pop_Shoot_v2_Game_Organic_Cartoon.wav",
    // Step 2
    drip: "SqueakDrip_SFXB.422.wav",
    panelPop: "ESM_Holographic_Screen_Appear_2_Glitch_Morph_Mechanism_Texture_Futuristic.wav",
    fieldBlips: "ESM_Scifi_Loading_Screen_Loop_1_Sci_Fi_Glitch_Morph_Mechanism_Texture_Futuristic.wav",
    wires: "ESM_Retro_Game_Weapon_Metallic_Laser_8_Bit_Arcade_80s_Weapon_Attack.wav",
    searching: "SpaceshipSonarPing_S011SF_1.wav",
    found: "DECAP_tonal_one_shot_xylophone_kids_G.wav",
    fetched: "HYPER_POTIONS_fx_one_shot_treasure_get_02_D.wav",
    // Step 3
    gridBlips: "ESM_Scifi_Loading_Screen_Loop_23_Sci_Fi_Glitch_Morph_Mechanism_Texture_Futuristic.wav",
    alarm: "shs_cyber_button_ui_denied_error_negative_double_3.wav",
    anvil: "FF_CRT_sfx_punch_knockout_high.wav",
    shatter: "ESM_Ambient_Game_Attack_Breaking_Stone_2_Impact_Shatter_Burst_Glass_Unlock.wav",
    fragments: "ESM_Ambient_Game_Power_Up_Small_Orb_Break_1_Glass_PickUp_Shatter_Burst_Unlock.wav",
    stamp: "StampSelfInking_S08OF.456.wav",
    accepted: "ESM_Positive_Casino_Score_Sound_FX_Arcade_Kids_Mobile_App.wav",
    slide: "ESM_FG2_FX_cards_one_shot_heavy_card_tarot_slide_short_02.wav",
    select: "MO_FN_foley_ui_select_sfx.wav",
    typing: "ComputerKeyboard_S08OF.109.wav",
    compiled: "ESM_PG_cinematic_fx_magic_award_collect_achievement_positive_treasure_chime_01.wav",
    // Step 4
    boxPop: "ESM_HCGUI_fx_select_movement_organic_pop.wav",
    dataStream: "ESM_Scifi_Loading_Screen_Loop_27_Sci_Fi_Glitch_Morph_Mechanism_Texture_Futuristic.wav",
    riser: "ESM_VCSFX_FX_risers_into_the_network_glitch_digital_noise_01.wav",
    downloaded: "ESM_New_Bonus_2_Sound_FX_Arcade_Casino_Kids_Mobile_App.wav",
    // Step 5
    cassette: "CassettePlayer_S011TE.89.wav",
    // Step 6
    pathTick: "ESM_HCGUI_fx_general_button_basic_tap_blipped.wav",
    fileFlight: "BULLYFINGER_fx_one_shot_dub_lickshot_16_up.wav",
    gulp: "ESM_GB_fx_foley_one_shot_toonpop_bubbles_power_up_pop_gurgle_cartoon.wav",
    confetti: "PartyPopperPull_S08FO.1795.wav",
    crowd: "MO_PS_vocal_group_wow.wav",
    saved: "ESM_Victory_Achievement_FX_16_Sound_FX_Arcade_Casino_Kids_Mobile_App.wav",
    // Finale and close
    finaleWipe: "ESM_GFTL_fx_transition_one_shots_alien_sci_fi_electric_movement_short_Cm.wav",
    finaleSting: "ESM_MMO_Game_Magic_Designed_Holy_Cast_06.wav",
    powerDown: "PE-PowerDown_BW.38712.wav",
};

const cue = (sound: keyof typeof SOUNDS, at: number, options: Omit<MixCue, "file" | "at"> = {}): MixCue => ({
    file: getAssetPath("sounds", "intro", SOUNDS[sound]),
    at,
    ...options,
});

/** Shifts pitch and speed together; needs the sound's own sample rate. */
const pitched = (sampleRate: number, semitones: number): string =>
    `asetrate=${Math.round(sampleRate * 2 ** (semitones / 12))}`;

// --- music ---

const BEAT = 60 / PREVIEW.bpm;
const BAR = BEAT * 4;

// 125 BPM in B♭, a semitone down: 118 BPM in A.
const ARP = { loopSamples: 338688, filter: `${pitched(44100, -1)},highpass=f=120` };
// A semitone down lands the key in A; the rest of the way to 118 BPM can't also come from
// pitch, or it would leave the key.
const HERO_FILTER = `${pitched(44100, -1)},atempo=${(PREVIEW.bpm / (122 * 2 ** (-1 / 12))).toFixed(5)}`;

// Tour timestamps.
const tour = (tau: number): number => T.TOUR_START + tau;
const step = (i: number): number => tour(sceneStart(i));

const BED_START = T.TOUR_START;
const BED_END = step(4) + PREVIEW.open;
const DRUMS_START = BED_START + 3 * BAR; // on a bar line, near the start of step 2
const SAVE_BED_START = step(4) + PREVIEW.play + 3 * BAR; // on a bar line, crossfading out of the hero track

const music: MixCue[] = [
    cue("idleArp", BED_START, {
        ...ARP,
        duration: BED_END - BED_START,
        fadeIn: 0.1,
        fadeOut: 0.6,
        gainDb: -15,
    }),
    cue("drums", DRUMS_START, {
        loopSamples: 368139,
        filter: "asetrate=45250,highpass=f=60", // 115 → 118 BPM; a sliver of pitch beats stretching drums
        duration: BED_END - DRUMS_START,
        fadeOut: 0.6,
        gainDb: -20,
    }),
    cue("heroTrack", step(4) + PREVIEW.play, {
        filter: HERO_FILTER,
        duration: step(5) - (step(4) + PREVIEW.play) + 0.6,
        fadeOut: 0.6,
        gainDb: -8,
    }),
    cue("idleArp", SAVE_BED_START, {
        ...ARP,
        duration: T.FINALE + FINALE.WIPE - SAVE_BED_START,
        fadeIn: 0.8,
        fadeOut: 0.6,
        gainDb: -17,
    }),
    // The song waits with the user. It fades out on its own as it ends, at OUTRO_SONG_END.
    cue("outro", FINALE.PROMPT, { gainDb: -7 }),
];

// --- awakening ---

// The eyes travel 1.7→1.95s and 2.3→2.5s: these land the swish's peak mid-motion.
const LOOK_LEFT = 1.77;
const LOOK_RIGHT = 2.35;

// The mascot's flight is at its fastest halfway, and lands with a wobble.
const FLIGHT_MIDDLE = T.TOUR + T.TOUR_MOVE / 2;
const LANDING = T.TOUR + T.TOUR_MOVE;

/** The face lights up, at the awakening and again at the finale. */
const wink = (at: number): MixCue[] => [
    cue("wink", at, { gainDb: -10 }),
    cue("facePop", at, { gainDb: -6 }),
    cue("sparks", at + 0.05, { gainDb: -8 }),
];

/** The title scrambling and locking into place. */
const title = (at: number): MixCue[] => [
    cue("scramble", at, { duration: T.LOGO_DURATION, fadeOut: 0.05, gainDb: -11 }),
    cue("lockIn", at + T.LOGO_DURATION, { gainDb: -5 }),
];

const awakening: MixCue[] = [
    // Cut by the wink.
    cue("drone", 0, { from: 1, duration: T.WINK + 0.08, fadeIn: 0.5, fadeOut: 0.08, gainDb: -7 }),
    // Only the top of the twinkle, following the dust's fade-in.
    cue("dust", T.DUST_IN, {
        duration: T.TOUR - T.DUST_IN,
        fadeIn: 1.2,
        fadeOut: 0.5,
        filter: "highpass=f=3000",
        gainDb: -8,
    }),
    // A glint as the eyes light up, then the first chirp alone as the lids start moving.
    cue("glint", T.EYES_IN, { from: 0.08, gainDb: -8 }),
    cue("lids", T.EYES_IN + 0.2, { duration: 0.13, gainDb: -16 }),
    cue("lookLeft", LOOK_LEFT, { pan: -0.7, gainDb: -12 }),
    cue("lookRight", LOOK_RIGHT, { pan: 0.7, gainDb: -10 }),
    ...wink(T.WINK),
    ...title(T.LOGO_IN),
    // Gone by the time the tour starts.
    cue("idleArp", T.IDLE, { ...ARP, duration: LANDING - T.IDLE, fadeIn: 0.03, fadeOut: 0.8, gainDb: -9 }),
    cue("dissolve", T.TOUR, { from: 0.2, duration: 1.6, fadeOut: 0.3, gainDb: -4 }),
    // An airy whoosh peaking mid-flight (its low end is only rumble), a rising slide into
    // the landing, and the boing.
    cue("flightWhoosh", FLIGHT_MIDDLE - 0.34, {
        from: 0.2,
        duration: 1.6,
        fadeOut: 0.3,
        filter: "highpass=f=800",
        gainDb: 8,
    }),
    cue("flightSlide", LANDING - 0.55, { duration: 0.55, fadeOut: 0.15, gainDb: -14 }),
    cue("boing", LANDING, { gainDb: -8 }),
];

// --- tour ---

// A little melody for the mascot's voice: each step, it starts on another note.
const VOICE_NOTES = [0, 2, -1, 3, 0, 5];

const everyStep: MixCue[] = VOICE_NOTES.flatMap((note, i) => [
    cue("voice", step(i) + 0.02, { filter: pitched(96000, note), gainDb: -18 }),
    // A different stretch of the blips for each caption.
    cue("captionBlips", step(i) + 0.1, { from: i * 1.1, duration: 1.25, fadeOut: 0.1, gainDb: 8 }),
    // The first step has nothing to wipe away.
    ...(i > 0 ? [cue("wipe", step(i), { duration: 0.6, fadeOut: 0.15, gainDb: -10 })] : []),
]);

const paste: MixCue[] = [
    { press: PASTE.press1, land: PASTE.land1, zap: "spotifyZap" as const },
    { press: PASTE.press2, land: PASTE.land2, zap: "youtubeZap" as const },
].flatMap(({ press, land, zap }) => [
    cue("keyPress", tour(press - 0.1), { gainDb: -4 }),
    cue("shockwave", tour(press), { gainDb: -14 }),
    cue(zap, tour(press + 0.05), { gainDb: -12 }),
    cue("rowLand", tour(land), { gainDb: -4 }),
]);

// Xylophone in G, up to A, C♯ and E.
const FOUND_NOTES = [2, 6, 9];

const fetch: MixCue[] = [
    cue("drip", tour(FETCH.start), { gainDb: -10 }),
    cue("panelPop", tour(FETCH.source), { from: 0.066, gainDb: -2 }),
    cue("fieldBlips", tour(FETCH.fields), { duration: 0.9, fadeOut: 0.1, gainDb: 12 }),
    cue("wires", tour(FETCH.edges), { gainDb: -8 }),
    cue("searching", tour(FETCH.nodes[0]), {
        duration: FETCH.nodes[2] + FETCH.travel - FETCH.nodes[0],
        fadeOut: 0.1,
        gainDb: -16,
    }),
    ...FETCH.nodes.map((node, i) =>
        cue("found", tour(node + FETCH.travel), { filter: pitched(48000, FOUND_NOTES[i]), gainDb: -9 })
    ),
    cue("fetched", tour(FETCH.done), { gainDb: -8 }),
];

// One value per row flies over, up the A major scale.
const SLIDE_NOTES = [0, 2, 4, 5, 7];
const COMPILE_ROW_STAGGER = 0.12;

const compare0 = step(2);
const compare: MixCue[] = [
    cue("gridBlips", compare0 + COMPARE.grid, { duration: 1.1, fadeOut: 0.1, gainDb: 10 }),
    cue("alarm", compare0 + COMPARE.flag, { gainDb: -12 }),
    // The wrong column gets an anvil dropped on it; its hit is on the very first frame.
    cue("anvil", compare0 + COMPARE.reject, { gainDb: -6 }),
    cue("shatter", compare0 + COMPARE.reject, { gainDb: -5 }),
    cue("fragments", compare0 + COMPARE.reject + 0.12, { gainDb: -9 }),
    // The stamp's second strike is its real thump.
    cue("stamp", compare0 + COMPARE.accept - 0.04, { from: 0.24, gainDb: -6 }),
    cue("accepted", compare0 + COMPARE.accept + 0.08, { filter: pitched(44100, -1), gainDb: -8 }),
    ...SLIDE_NOTES.map((note, row) =>
        cue("slide", compare0 + COMPARE.compile + row * COMPILE_ROW_STAGGER, {
            filter: pitched(44100, note),
            gainDb: -9,
        })
    ),
    cue("select", compare0 + COMPARE.select, { gainDb: -6 }),
    cue("typing", compare0 + COMPARE.edit + 0.35, { duration: 0.8, fadeOut: 0.05, gainDb: 8 }),
    cue("compiled", compare0 + COMPARE.done, { filter: pitched(48000, 1), duration: 2.2, fadeOut: 0.4, gainDb: -7 }),
];

const BOX_NOTES = [0, 4, 7];
const BOX_STAGGER = 0.15;
const RISER_TO_PEAK = 2.5;

const download0 = step(3);
const downloadStart = download0 + DOWNLOAD.start;
const downloadEnd = download0 + DOWNLOAD.end;
const download: MixCue[] = [
    ...BOX_NOTES.map((note, i) =>
        cue("boxPop", download0 + DOWNLOAD.boxes + i * BOX_STAGGER, { filter: pitched(96000, note), gainDb: -7 })
    ),
    cue("dataStream", downloadStart, {
        loopSamples: 148837,
        duration: DOWNLOAD.end - DOWNLOAD.start,
        fadeIn: 0.2,
        fadeOut: 0.1,
        gainDb: 12,
    }),
    // The engine: the opening drone again, thinned so it hums rather than rumbles.
    cue("drone", downloadStart, {
        from: 30,
        duration: DOWNLOAD.end - DOWNLOAD.start,
        fadeIn: 1,
        fadeOut: 0.1,
        filter: "highpass=f=70",
        gainDb: -13,
    }),
    cue("riser", downloadEnd - RISER_TO_PEAK, { duration: RISER_TO_PEAK, fadeOut: 0.08, gainDb: -12 }),
    cue("downloaded", downloadEnd, { filter: pitched(44100, -3), gainDb: -6 }),
];

const preview: MixCue[] = [cue("cassette", step(4) + PREVIEW.open, { from: 0.15, gainDb: 8 })];

const PATH_NOTES = [0, 4, 7];
const PATH_STAGGER = 0.35;

const save0 = step(5);
const save: MixCue[] = [
    ...PATH_NOTES.map((note, i) =>
        cue("pathTick", save0 + SAVE.path + i * PATH_STAGGER, { filter: pitched(96000, note), gainDb: -8 })
    ),
    // The end of the pulses, where they rush: they reach their fastest as the file lands.
    cue("fileFlight", save0 + SAVE.fly, { from: 0.7, duration: SAVE.land - SAVE.fly, gainDb: -8 }),
    cue("gulp", save0 + SAVE.land, { gainDb: -3 }),
    cue("confetti", save0 + SAVE.land, { gainDb: -8 }),
    cue("crowd", save0 + SAVE.land + 0.15, { gainDb: -14 }),
    cue("saved", save0 + SAVE.land + 0.2, { filter: pitched(44100, -3), gainDb: -3 }),
];

const finale: MixCue[] = [
    cue("finaleWipe", T.FINALE, { from: 0.14, gainDb: -8 }),
    ...wink(FINALE.WINK),
    cue("finaleSting", FINALE.WINK, { filter: pitched(96000, -1), gainDb: -8 }),
    ...title(FINALE.LOGO_IN),
];

export const INTRO_CUES: MixCue[] = [
    ...music,
    ...awakening,
    ...everyStep,
    ...paste,
    ...fetch,
    ...compare,
    ...download,
    ...preview,
    ...save,
    ...finale,
];

// Closing can come at any time, so it can't be on the timeline: it's a mix of its own,
// started on demand. Same wink as the first, higher, for the tiny 😉 it lands as.
const LANDING_WINK = 0.96;

export const OUTRO_CUES: MixCue[] = [
    cue("powerDown", 0, { duration: 1.2, fadeOut: 0.2, gainDb: -9 }),
    cue("wink", LANDING_WINK, { filter: pitched(44100, 7), gainDb: -14 }),
];

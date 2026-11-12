import open from "open";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { type Task } from "#base/task/task";
import { dialogBridge, type DialogLink, type ListDialogBody } from "#base/bridges/dialogBridge";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { StatusType } from "#base/task/task-status";
import { globalLogger } from "#base/logger/logger";
import { SettingsStore } from "#settings/settingsStore";
import { APP_VERSION } from "#constants";
import { getMusicSettings } from "../settings";
import { computeCompiledMetadata } from "../utils/compiledMetadata";
import { type DownloadTask } from "../utils/downloadTask";
import { type MusicDownloadTaskAttributes } from "../types";
import { MusicBrainzClient } from "../services/apis/musicbrainz-client";
import { buildReleaseSeed, formatSeedPreview } from "./buildReleaseSeed";
import { harmonyReleaseUrl } from "./harmonyLink";
import { checkMusicBrainzIdentity } from "./identityCheck";
import { externalLinks } from "./externalLinks";
import { artistKey, canonicalUrl, normalizeText, normalizeUrl } from "./normalize";
import { startSeedSession } from "./seedServer";
import {
    type MbArtistRef,
    type MbRelease,
    type MbReleaseCandidate,
    type MbResolvedArtist,
    type MbUserChoice,
    type MusicBrainzIdentity,
    type ProviderArtist,
} from "./types";

/**
 * What the user can do about a track's MusicBrainz verdict (P30): review candidates, pick between same-name artists,
 * re-check, and add a release that is missing. Plain async functions that talk to the user through `dialogBridge`,
 * so they work from a shortcut handler and are testable without React.
 *
 * The rule over all of it: nothing reaches MusicBrainz except through the user's own browser, behind MusicBrainz's own
 * confirmation page and editor.
 */

const logger = globalLogger.createChild({ service: "MusicBrainzActions" });

const MB_URL = "https://musicbrainz.org";
const accent = (): string => providerDisplayRegistry.get("musicBrainz").color;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────

function attributesOf(task: DownloadTask) {
    return task.getAttributes();
}

function identityOf(task: DownloadTask): MusicBrainzIdentity | undefined {
    return attributesOf(task)?.musicBrainzIdentity;
}

function compiledOf(task: DownloadTask) {
    const attrs = attributesOf(task);
    return attrs ? computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride) : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isTrackTask(task: Task<any>): task is DownloadTask {
    return (task.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "track";
}

/** The tracks (imported tasks) of the same album as `task`, itself included — they are all on the same release. */
export function albumSiblings(task: DownloadTask): DownloadTask[] {
    const key = albumKeyOf(task);
    if (!key) return [task];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = TaskOrchestrator.getInstance().getTasks() as Task<any>[];
    const same = all.filter(isTrackTask).filter((t) => albumKeyOf(t) === key);
    return same.includes(task) ? same : [task, ...same];
}

function albumKeyOf(task: DownloadTask): string | undefined {
    const url = compiledOf(task)?.album?.url;
    return url ? normalizeUrl(url) : undefined;
}

async function notify(title: string, message: string): Promise<void> {
    await dialogBridge.confirm({ title, message, choices: [{ label: "OK", tone: "primary" }], accent: accent() });
}

const settled = (promises: Promise<unknown>[]) => Promise.allSettled(promises);

// ── Re-check ─────────────────────────────────────────────────────────────────────────────

/** Asks MusicBrainz again, ignoring what was remembered. */
export async function recheckMusicBrainz(task: DownloadTask): Promise<void> {
    await task.checkMusicBrainz({ force: true });
}

// ── Review: which release? ───────────────────────────────────────────────────────────────

function releaseLines(candidate: MbReleaseCandidate): string[] {
    const { release } = candidate;
    const facts = [
        [release.date, release.country, release.format, release.status].filter(Boolean).join(" · "),
        release.trackCount != null ? `${release.trackCount} tracks` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    return [facts, ...(candidate.notes ?? []).map((e) => `✔ ${e}`), `${MB_URL}/release/${release.id}`]
        .filter(Boolean)
        .slice(0, 5);
}

/** Most releases whose links are fetched for one dialog (each is a request, MusicBrainz allows about one a second). */
const LINK_FETCH_LIMIT = 5;

/**
 * The same releases with their external links (a release's URL relationships) loaded: those that have none loaded yet
 * are looked up, up to `LINK_FETCH_LIMIT`; one that cannot be looked up is left as it is (it just shows no links).
 */
async function withLinks(releases: MbRelease[]): Promise<MbRelease[]> {
    const client = new MusicBrainzClient();
    let fetched = 0;
    const result: MbRelease[] = [];
    for (const release of releases) {
        if (release.urls || fetched >= LINK_FETCH_LIMIT) {
            result.push(release);
            continue;
        }
        fetched++;
        try {
            result.push({ ...release, urls: (await client.getRelease(release.id)).urls ?? [] });
        } catch (error) {
            logger.warn(`Could not load the links of release ${release.id}`, { error });
            result.push(release);
        }
    }
    return result;
}

/**
 * What a list dialog shows once its content is ready. The dialog itself opens at once, with a loader: the content is a
 * promise, started here. (A rejection nobody listens to — no UI to show it — must not become an unhandled one.)
 */
function loadedBody<T extends ListDialogBody | null>(content: Promise<T>): Promise<T> {
    content.catch(() => undefined);
    return content;
}

/** Lets the user pick the right release among the candidates — or say none is. Applies to the whole album. */
export async function reviewMusicBrainzRelease(task: DownloadTask): Promise<void> {
    const stored = identityOf(task);
    if (stored?.verdict !== "needsReview" || stored.candidates.length === 0) return;

    const compiled = compiledOf(task);
    const album = compiled?.album;
    const intro = [
        `${compiled?.trackName ?? ""} — ${compiled?.artists.map((a) => a.name).join(", ") ?? ""}`,
        album ? `Album: ${album.albumName}${album.totalTracks ? ` (${album.totalTracks} tracks)` : ""}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    // Each candidate's links (Spotify, Bandcamp, Discogs…) help to tell the releases apart: they are loaded while the
    // dialog is already open, and kept on the verdict so the next review does not ask again.
    let candidates = stored.candidates;
    const body = loadedBody(
        (async (): Promise<ListDialogBody> => {
            const loaded = await withLinks(stored.candidates.map((c) => c.release));
            candidates = stored.candidates.map((c, i) => ({ ...c, release: loaded[i] }));
            if (identityOf(task) === stored) {
                task.updateAttributes({ musicBrainzIdentity: { ...stored, candidates } });
            }
            return {
                intro,
                items: candidates.map((c) => candidateItem(c)),
                noneLabel: "None of these — this release is not in MusicBrainz",
            };
        })()
    );
    const answer = await dialogBridge.choose({
        title: "Which MusicBrainz release is this?",
        intro,
        items: [],
        body,
        loadingLabel: "Loading the releases' links…",
        accent: accent(),
    });
    if (!answer) return;

    if ("index" in answer) {
        await applyReleaseDecision(task, { chosen: candidates[answer.index].release });
    } else {
        await applyReleaseDecision(task, { rejectedIds: candidates.map((c) => c.release.id) });
    }
}

function candidateItem(c: MbReleaseCandidate, suffix = "") {
    return {
        label: `${c.release.title} — ${c.release.artists.map((a) => a.name).join(", ") || "?"}${suffix}`,
        detail: releaseLines(c),
        url: `${MB_URL}/release/${c.release.id}`,
        links: externalLinks(c.release),
    };
}

/**
 * The releases that could be this track's although one is matched (the digital edition, the CD whose barcode it
 * shares, the rest of the release group): the user can see them and pick another. Applies to the whole album, like any
 * release decision.
 */
export async function chooseMusicBrainzAlternative(task: DownloadTask): Promise<void> {
    const stored = identityOf(task);
    const alternatives = stored?.alternatives ?? [];
    if (stored?.verdict !== "matched" || !stored.release || alternatives.length === 0) return;

    const compiled = compiledOf(task);
    const intro = [
        `${compiled?.trackName ?? ""} — ${compiled?.artists.map((a) => a.name).join(", ") ?? ""}`,
        "The first one is matched now. Pick another if it is the one you mean: it holds for the whole album.",
    ]
        .filter(Boolean)
        .join("\n");

    // The dialog opens at once; the releases' links (a request each) are loaded behind its loader.
    let withUrls = alternatives;
    const body = loadedBody(
        (async (): Promise<ListDialogBody> => {
            const [currentRelease, ...alternativeReleases] = await withLinks([
                stored.release!,
                ...alternatives.map((c) => c.release),
            ]);
            withUrls = alternatives.map((c, i) => ({ ...c, release: alternativeReleases[i] }));
            if (identityOf(task) === stored) {
                task.updateAttributes({
                    musicBrainzIdentity: { ...stored, release: currentRelease, alternatives: withUrls },
                });
            }
            const current: MbReleaseCandidate = {
                release: currentRelease,
                evidence: [],
                notes: ["Matched now", ...stored.evidence],
            };
            return {
                intro,
                items: [candidateItem(current, "  (matched now)"), ...withUrls.map((c) => candidateItem(c))],
            };
        })()
    );
    const answer = await dialogBridge.choose({
        title: "Other MusicBrainz releases",
        intro,
        items: [],
        body,
        loadingLabel: "Loading the releases' links…",
        accent: accent(),
    });
    if (!answer || !("index" in answer) || answer.index === 0) return;
    await applyReleaseDecision(task, { chosen: withUrls[answer.index - 1].release });
}

type ReleaseDecision = { chosen: MbReleaseCandidate["release"] } | { rejectedIds: string[] };

/** The user's word about the release holds for every track of the album. */
async function applyReleaseDecision(task: DownloadTask, decision: ReleaseDecision): Promise<void> {
    await settled(
        albumSiblings(task).map((t) => {
            const albumKey = albumKeyOf(t);
            return t.checkMusicBrainz({
                // `previous` is read when the check runs, not now: a check already under way must not undo this.
                decide: (current) => {
                    // A release decision made about another album does not carry over to this one.
                    const previous: MbUserChoice =
                        current.albumKey === albumKey
                            ? current
                            : { ...current, chosenRelease: undefined, rejectedReleaseIds: [], albumKey };
                    return "chosen" in decision
                        ? {
                              ...previous,
                              chosenRelease: decision.chosen,
                              rejectedReleaseIds: previous.rejectedReleaseIds.filter((id) => id !== decision.chosen.id),
                          }
                        : {
                              ...previous,
                              chosenRelease: undefined,
                              rejectedReleaseIds: [
                                  ...new Set([...previous.rejectedReleaseIds, ...decision.rejectedIds]),
                              ],
                          };
                },
            });
        })
    );
}

// ── The matched release's other pages ────────────────────────────────────────────────────

/** Lists the pages other services have for the matched release and opens the one picked (in its app when it has one). */
export async function openMusicBrainzExternalLinks(task: DownloadTask): Promise<void> {
    const stored = identityOf(task);
    if (!stored?.release) return;

    let links: DialogLink[] = [];
    let release = stored.release;
    let none = false;
    const body = loadedBody(
        (async (): Promise<ListDialogBody | null> => {
            [release] = await withLinks([stored.release!]);
            if (identityOf(task) === stored) task.updateAttributes({ musicBrainzIdentity: { ...stored, release } });
            links = externalLinks(release);
            if (links.length === 0) {
                none = true;
                return null; // nothing to list: the dialog closes, and the user is told below
            }
            return {
                intro: `${release.title} — ${release.artists.map((a) => a.name).join(", ")}`,
                items: links.map((l) => ({
                    label: l.openUrl === l.url ? l.label : `${l.label}  (opens in the app)`,
                    detail: [l.url],
                    url: l.url,
                })),
            };
        })()
    );
    const answer = await dialogBridge.choose({
        title: "Pages of this MusicBrainz release",
        intro: `${stored.release.title} — ${stored.release.artists.map((a) => a.name).join(", ")}`,
        items: [],
        body,
        loadingLabel: "Loading the release's links…",
        accent: accent(),
    });
    if (none) {
        await notify(
            "No other pages",
            "MusicBrainz lists no other page (Spotify, Bandcamp, Discogs…) for this release yet."
        );
        return;
    }
    if (answer && "index" in answer) await open(links[answer.index].openUrl);
}

// ── Review: which artist? ────────────────────────────────────────────────────────────────

/** Artists the evidence could not link but a name search found same-name candidates for. */
export function ambiguousArtists(identity: MusicBrainzIdentity | undefined): MbResolvedArtist[] {
    return (identity?.artists ?? []).filter((a) => !a.mbid && !a.isNew && a.candidates.length > 0);
}

function artistLabel(a: MbArtistRef): string {
    return `${a.name}${a.disambiguation ? ` (${a.disambiguation})` : ""}${a.country ? ` · ${a.country}` : ""}`;
}

/** Asks which MusicBrainz artist `artist` is. Resolves undefined when dismissed, null for "a new artist". */
async function askArtist(artist: MbResolvedArtist): Promise<string | null | undefined> {
    const answer = await dialogBridge.choose({
        title: `Which MusicBrainz artist is "${artist.name}"?`,
        intro: "Several artists share this name. Pick the one you mean — or none, if yours is not in MusicBrainz yet.",
        items: artist.candidates.map((c) => ({
            label: artistLabel(c),
            detail: [`${MB_URL}/artist/${c.id}`],
            url: `${MB_URL}/artist/${c.id}`,
        })),
        noneLabel: "None of these — a new artist",
        accent: accent(),
    });
    if (!answer) return undefined;
    return "index" in answer ? artist.candidates[answer.index].id : null;
}

export async function reviewMusicBrainzArtists(task: DownloadTask): Promise<void> {
    const choices: MbUserChoice["artistChoices"] = {};
    for (const artist of ambiguousArtists(identityOf(task))) {
        const picked = await askArtist(artist);
        if (picked === undefined) break; // Esc: stop asking, keep what was answered
        choices[artistKey(artist)] = picked;
    }
    if (Object.keys(choices).length > 0) await applyArtistChoices(task, choices);
}

async function applyArtistChoices(task: DownloadTask, choices: MbUserChoice["artistChoices"]): Promise<void> {
    await settled(
        albumSiblings(task).map((t) =>
            t.checkMusicBrainz({
                decide: (current) => ({ ...current, artistChoices: { ...current.artistChoices, ...choices } }),
            })
        )
    );
}

// ── Add the release to MusicBrainz ───────────────────────────────────────────────────────

const inProgress = new Set<string>();

async function ensureContributeConsent(): Promise<boolean> {
    const settings = getMusicSettings().musicBrainz;
    if (settings.contribute) return true;
    if (settings.contributeAsked) {
        await notify(
            "Adding releases is turned off",
            "You chose not to add releases to MusicBrainz. You can allow it in Settings → MusicBrainz."
        );
        return false;
    }
    const answer = await dialogBridge.confirm({
        title: "Add missing releases to MusicBrainz?",
        message:
            "When a release is not in MusicBrainz, Goblin Malin can open the MusicBrainz editor with it pre-filled " +
            "(or send you to Harmony, a public import tool, which looks up the streaming links you gave).\n\n" +
            "You must be logged in to MusicBrainz. You review everything there and press “Enter edit” yourself: " +
            "edits are public and carry your MusicBrainz username. Goblin Malin never submits anything by itself.",
        choices: [
            { label: "Not now", tone: "muted" },
            { label: "Allow", tone: "success" },
        ],
        accent: accent(),
    });
    if (answer === null) return false; // dismissed: not an answer, ask again next time
    const allowed = answer === 1;
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { contribute: allowed, contributeAsked: true } });
    logger.info(
        allowed ? "User allowed adding releases to MusicBrainz" : "User declined adding releases to MusicBrainz"
    );
    return allowed;
}

function dedupeArtists(artists: ProviderArtist[]): ProviderArtist[] {
    const seen = new Set<string>();
    return artists.filter((a) => {
        const key = normalizeText(a.name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * The whole "add this release" flow: checks the album once more, track by track, asks about same-name artists, shows
 * what would be sent, and — only on a yes — opens the user's browser. Harmony does the import, or the local seed
 * server fills MusicBrainz' own editor and learns the new release id when the user is done (setting `contributeVia`).
 */
export async function addToMusicBrainz(task: DownloadTask): Promise<void> {
    const id = task.getId();
    if (inProgress.has(id)) return;
    inProgress.add(id);
    const status = ownedStatus(task);
    try {
        const identity = identityOf(task);
        if (identity?.verdict !== "notFound") {
            await notify(
                "Can't add this release",
                "MusicBrainz was not ruled out for it: check or review the match first."
            );
            return;
        }
        if (!(await ensureContributeConsent())) return;

        const compiled = compiledOf(task);
        const album = compiled?.album;
        if (!album) {
            await notify("Can't add this release", "The metadata sources gave no album for this track.");
            return;
        }

        status.set({
            type: StatusType.Processing,
            message: "Checking MusicBrainz before adding…",
            timeTracking: true,
            progress: 0,
        });
        const details = await task.fetchAlbumDetails({ id: album.id, url: album.url }, { withIsrcs: true });
        if (!details || details.tracks.length === 0) {
            status.clear();
            await notify(
                "Can't read the album",
                "The streaming service did not give the album's track list (the official Spotify API is needed), so nothing can be prepared."
            );
            return;
        }

        // A last, album-wide look: every track with an ISRC is asked again, under the same rules as any verdict.
        const lookups = new MusicBrainzClient();
        const recordingByTrackId: Record<string, string> = {};
        const artistByName: Record<string, MbResolvedArtist> = {};
        const checkable = details.tracks.filter((t) => t.isrc);
        let blocked:
            { trackName: string; verdict: MusicBrainzIdentity["verdict"]; identity: MusicBrainzIdentity } | undefined;
        for (const [i, t] of checkable.entries()) {
            const result = await checkMusicBrainzIdentity(
                lookups,
                details,
                { name: t.name, isrc: t.isrc, artists: dedupeArtists([...details.artists, ...t.artists]) },
                { force: i === 0, user: identity.userChoice }
            );
            status.update({ progress: Math.round(((i + 1) / checkable.length) * 100) });
            if (result.verdict !== "notFound") {
                blocked = { trackName: t.name, verdict: result.verdict, identity: result };
                break;
            }
            if (result.recordingId) recordingByTrackId[t.id] = result.recordingId;
            for (const a of result.artists) artistByName[normalizeText(a.name)] ??= a;
        }
        status.clear();

        if (blocked) {
            await task.checkMusicBrainz({ force: true });
            const release = blocked.identity.release ?? blocked.identity.candidates[0]?.release;
            await notify(
                blocked.verdict === "unknown" ? "Couldn't check MusicBrainz" : "Not adding: this may already exist",
                blocked.verdict === "unknown"
                    ? `A check could not be completed (${blocked.identity.evidence.join("; ") || "no answer"}). Nothing was prepared; try again in a moment.`
                    : `Track “${blocked.trackName}” of this album is already on a MusicBrainz release${
                          release ? `:\n${release.title}\n${MB_URL}/release/${release.id}` : "."
                      }\nReview the match on the track instead of adding a duplicate.`
            );
            return;
        }

        // Same-name artists: the user picks, here, once — never a guess.
        const newChoices: MbUserChoice["artistChoices"] = {};
        const asked = new Set<string>();
        for (const artist of Object.values(artistByName)) {
            if (artist.mbid || artist.isNew || artist.candidates.length === 0) continue;
            const key = artistKey(artist);
            if (asked.has(key) || asked.size >= 5) continue;
            asked.add(key);
            const picked = await askArtist(artist);
            if (picked === undefined) return; // cancelled: nothing was sent anywhere
            newChoices[key] = picked;
            artistByName[normalizeText(artist.name)] =
                picked === null ? { ...artist, isNew: true } : { ...artist, mbid: picked, evidence: "user" };
        }
        if (Object.keys(newChoices).length > 0) await applyArtistChoices(task, newChoices);

        const settings = getMusicSettings().musicBrainz;
        const via = settings.contributeVia === "direct" ? "direct" : "harmony";
        const noIsrc = details.tracks.length - checkable.length;
        const editNote =
            `Seeded by Goblin Malin ${APP_VERSION} (https://github.com/Tetraxel/goblin-malin) from ${canonicalUrl(details.url)}` +
            `${details.barcode ? `, barcode ${details.barcode}` : ""}. Checked beforehand for an existing release: barcode, streaming link, ISRCs, title + artist.`;
        const albumArtists = details.artists.map(
            (a) => artistByName[normalizeText(a.name)] ?? { name: a.name, url: a.url, candidates: [] }
        );
        const seedInput = { album: details, albumArtists, artistByName, recordingByTrackId, editNote };
        const { preview } = buildReleaseSeed(seedInput);

        const viaText =
            via === "harmony"
                ? `Opens Harmony in your browser (${new URL(harmonyReleaseUrl(settings.harmonyUrl, details.url)).host}), which looks for duplicates and opens the MusicBrainz editor pre-filled — its own version of the data above.`
                : "Opens the MusicBrainz release editor in your browser, pre-filled with the data above.";
        const checked =
            `Checked first: barcode, streaming link, ${checkable.length} ISRC${checkable.length === 1 ? "" : "s"}, title + artist — nothing found.` +
            (noIsrc > 0 ? ` (${noIsrc} track${noIsrc === 1 ? " has" : "s have"} no ISRC to check.)` : "");

        const answer = await dialogBridge.confirm({
            title: "Add to MusicBrainz",
            message: `${formatSeedPreview(preview, viaText)}\n\n${checked}`,
            choices: [
                { label: "Cancel", tone: "muted" },
                { label: "Open in browser", tone: "primary" },
            ],
            accent: accent(),
        });
        if (answer !== 1) return;

        markHandedOff(task);
        if (via === "harmony") {
            await open(harmonyReleaseUrl(settings.harmonyUrl, details.url, details.barcode));
            await notify(
                "Continue in your browser",
                "Review the release in Harmony, open the MusicBrainz editor from it and press “Enter edit”.\n\nWhen you are done, press Re-check on this track to pick the new release up."
            );
            return;
        }

        const session = await startSeedSession((redirectUri) => buildReleaseSeed({ ...seedInput, redirectUri }).fields);
        await open(session.url);
        status.set({ type: StatusType.PendingUserAction, message: "Waiting for you in MusicBrainz…" });
        const outcome = await session.outcome;
        status.clear();
        logger.info(`MusicBrainz seed session ended: ${outcome.reason}`);
        if (outcome.reason === "added") {
            await settled(
                albumSiblings(task).map((t) => t.checkMusicBrainz({ force: true, knownReleaseId: outcome.releaseMbid }))
            );
        } else if (outcome.reason !== "closed") {
            await notify(
                "No release was reported",
                "Nothing came back from MusicBrainz (the edit may not have been submitted). If you did add it, press Re-check on this track."
            );
        }
    } finally {
        inProgress.delete(id);
        status.clear();
    }
}

/**
 * The task's status line, for the progress of this flow only. A task that is running (downloading, discovering) owns
 * its status: this flow then shows nothing rather than overwrite it, and never clears what it did not set.
 */
function ownedStatus(task: DownloadTask) {
    const taskStatus = task.getStatus();
    const free = !task.running;
    let shown = false;
    return {
        set(attributes: Parameters<typeof taskStatus.set>[0]): void {
            if (!free) return;
            shown = true;
            taskStatus.set(attributes);
        },
        update(attributes: Parameters<typeof taskStatus.update>[0]): void {
            if (shown) taskStatus.update(attributes);
        },
        clear(): void {
            if (!shown) return;
            shown = false;
            taskStatus.clear();
        },
    };
}

function markHandedOff(task: DownloadTask): void {
    const identity = identityOf(task);
    if (identity)
        task.updateAttributes({ musicBrainzIdentity: { ...identity, handedOffAt: new Date().toISOString() } });
}

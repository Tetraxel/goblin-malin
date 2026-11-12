import type { IArtist, IArtistCredit, IRecording, IRelease } from "musicbrainz-api";
import { sumTrackCounts } from "./normalize";
import { type MbArtistRef, type MbRecording, type MbRelease } from "./types";

/** Entities from the `musicbrainz-api` package → the trimmed shapes the resolver works on. */

export function toMbArtist(artist: IArtist): MbArtistRef {
    return {
        id: artist.id,
        name: artist.name,
        ...(artist.disambiguation ? { disambiguation: artist.disambiguation } : {}),
        ...(artist.country ? { country: artist.country } : {}),
    };
}

export function toMbArtistsFromCredit(credit: IArtistCredit[] | undefined): MbArtistRef[] {
    return (credit ?? []).filter((c) => c.artist?.id).map((c) => ({ ...toMbArtist(c.artist), name: c.artist.name }));
}

export function toMbRelease(release: IRelease): MbRelease {
    const urls = release.relations?.map((r) => r.url?.resource).filter((u): u is string => !!u);
    return {
        id: release.id,
        title: release.title,
        artists: toMbArtistsFromCredit(release["artist-credit"]),
        ...(release.date ? { date: release.date } : {}),
        ...(release.country ? { country: release.country } : {}),
        ...(release.status ? { status: release.status } : {}),
        ...(release.barcode ? { barcode: release.barcode } : {}),
        ...trackCountOf(release),
        ...(release.media?.[0]?.format ? { format: release.media[0].format } : {}),
        ...(release["release-group"]?.id ? { releaseGroupId: release["release-group"].id } : {}),
        ...(urls && urls.length > 0 ? { urls } : {}),
    };
}

function trackCountOf(release: IRelease): { trackCount?: number } {
    const count = release["track-count"] ?? sumTrackCounts(release.media);
    return typeof count === "number" ? { trackCount: count } : {};
}

export function toMbRecording(recording: IRecording): MbRecording {
    return {
        id: recording.id,
        title: recording.title,
        ...(typeof recording.length === "number" ? { lengthMs: recording.length } : {}),
        artists: toMbArtistsFromCredit(recording["artist-credit"]),
        releases: (recording.releases ?? []).map(toMbRelease),
    };
}

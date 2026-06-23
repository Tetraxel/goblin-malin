import { Logger } from "#base/logger/logger";
import { ProviderDisplay } from "#base/providerDisplay";
import { ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { Cached } from "#utils/cache";
import type { TrackMetadata, DiscoveryResult } from "#flows/musicDownloadFlow/types";
import { DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { MusicBrainzClient } from "../../apis/musicbrainz-client";
import { extractTracksFromMusicBrainzRecording } from "./convertMusicBrainzToTrack";
import { MusicBrainzCell } from "./MusicBrainzCell";

export class MusicBrainzDiscoveryService extends DiscoveryMetadataService {
    static readonly display: ProviderDisplay = {
        label: "MusicBrainz",
        acronym: "MB",
        color: "#741b81",
        colorSubtle: "#6b1060",
        colorBright: "#ba47b5",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable", defaultValue: true, kind: "checkbox" },
    };
    static readonly cellComponent = MusicBrainzCell;

    private static client: MusicBrainzClient;

    constructor(task: DownloadTask, logger: Logger) {
        super("MusicBrainzDiscoveryService", task, logger);
    }

    private getClient(): MusicBrainzClient {
        if (!MusicBrainzDiscoveryService.client) {
            MusicBrainzDiscoveryService.client = new MusicBrainzClient();
        }
        return MusicBrainzDiscoveryService.client;
    }

    @Cached()
    async discoverFromUri(sourceMetadata: TrackMetadata): Promise<DiscoveryResult> {
        const isrc = sourceMetadata.isrc;
        const trackName = sourceMetadata.trackName;
        const artistName = sourceMetadata.artists?.[0]?.name;

        // Need at least an ISRC or a track name to resolve a recording.
        if (!isrc && !trackName) return { tracks: [], anchor: { state: "notFound" } };

        const label = isrc ? `ISRC ${isrc}` : `"${trackName}"`;
        this.logger.info(`Discovering tracks via MusicBrainz for: ${label}`);
        this.status.set({
            type: StatusType.Processing,
            message: "Discovering via MusicBrainz",
            timeTracking: true,
            progress: 0,
        });

        try {
            const client = this.getClient();

            const recordingId = await client.findRecordingId({ isrc, trackName, artistName });
            if (!recordingId) {
                this.logger.info(`MusicBrainz found no recording for: ${label}`);
                this.status.clear();
                return { tracks: [], anchor: { state: "notFound" } };
            }

            this.status.update({ progress: 50 });

            const recording = await client.getRecordingWithUrls(recordingId);
            const tracks = extractTracksFromMusicBrainzRecording(recording);

            this.logger.info(`MusicBrainz discovered ${tracks.length} track(s) for: ${label}`);
            this.logger.info(`MusicBrainz discovered tracks: ${tracks.map((t) => t.trackName).join(", ")}`);

            this.status.update({ progress: 100 });
            this.status.clear();

            const recordingUrl = `https://musicbrainz.org/recording/${recordingId}`;
            const picardUri = `http://127.0.0.1:8000/opennat?id=${recordingId}`;

            return {
                tracks,
                anchor: {
                    state: "found",
                    url: recordingUrl,
                    id: recordingId,
                    openUri: picardUri,
                    count: tracks.length,
                },
            };
        } catch (error) {
            this.logger.error(`Error discovering via MusicBrainz for: ${label}`, { error });
            this.status.set({
                type: StatusType.Error,
                message: "Error discovering via MusicBrainz",
            });
            throw error;
        }
    }
}

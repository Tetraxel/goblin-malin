import React from "react";
import { Box, Text } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";

const PLATFORM_DISPLAY: Record<string, { label: string; color: string }> = {
  spotify: { label: "Spotify", color: "#1ed760" },
  youtube: { label: "Youtube", color: "#ff0033" },
  youtubeMusic: { label: "YT Music", color: "#ff0033" },
  musicBrainz: { label: "MusicBrainz", color: "#741b81" },
  deezer: { label: "Deezer", color: "#9546f7" },
  appleMusic: { label: "Apple Music", color: "#fb233b" },
  itunes: { label: "iTunes", color: "#fb233b" },
  tidal: { label: "Tidal", color: "#ffffff" },
  soundcloud: { label: "SoundCloud", color: "#ff5510" },
  bandcamp: { label: "Bandcamp", color: "#3b8db2" },
};

function getPlatformDisplay(apiProvider: string): {
  label: string;
  color: string;
} {
  return (
    PLATFORM_DISPLAY[apiProvider] ?? { label: apiProvider, color: "white" }
  );
}

interface MetadataHeaderProps {
  source: TrackDownloadSource;
}

export function MetadataHeader({ source }: MetadataHeaderProps) {
  const m = source.track;
  const { label: platformLabel, color: platformColor } = getPlatformDisplay(
    m.apiProvider,
  );
  const type = m.type
    ? m.type.charAt(0).toUpperCase() + m.type.slice(1)
    : "Track";
  const artist = m.artists?.[0]?.name ?? "";
  const title = m.trackName ?? "";
  const info = artist ? `${artist} - ${title}` : title;
  const parts = [platformLabel, type, m.id].filter(Boolean);

  return (
    <Box paddingLeft={2} flexDirection="row" overflow="hidden">
      <Text color="gray">{"└─ used "}</Text>
      {parts.map((part, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <Text color="gray">{" > "}</Text>}
          <Text color={platformColor as any} wrap="truncate-end">
            {part}
          </Text>
        </React.Fragment>
      ))}
      <Text color="white" wrap="truncate-end">{` (${info})`}</Text>
    </Box>
  );
}

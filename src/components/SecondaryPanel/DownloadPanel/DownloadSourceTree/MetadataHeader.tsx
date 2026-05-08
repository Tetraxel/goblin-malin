import React from "react";
import { Box, Text } from "ink";
import { TrackDownloadSource } from "../../../../flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "../../../../base/providerDisplay";

function getPlatformDisplay(apiProvider: string): {
  label: string;
  color: string;
} {
  const display = providerDisplayRegistry.get(apiProvider);
  return { label: display.label, color: display.color };
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

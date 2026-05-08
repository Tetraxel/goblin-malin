import React from "react";
import { Box, Text } from "ink";
import { MetadataSourceState } from "../../../flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "../../../base/providerDisplay";

function getDisplay(apiProvider: string): { label: string; color: string } {
  const display = providerDisplayRegistry.get(apiProvider);
  return { label: display.label, color: display.color };
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `(${m}:${s.toString().padStart(2, "0")})`;
}

function confidenceBadge(confidence: number | undefined): {
  text: string;
  color: string;
} {
  if (confidence === undefined) return { text: "[??%]", color: "gray" };
  const text = `[${confidence.toString().padStart(3, " ")}%]`;
  if (confidence >= 90) return { text, color: "green" };
  if (confidence >= 70) return { text, color: "yellow" };
  if (confidence >= 50) return { text, color: "gray" };
  return { text, color: "red" };
}

interface SourceRowProps {
  source: MetadataSourceState;
  isSelected: boolean;
  isActive: boolean;
  width: number;
}

export const MetadataSourceRow: React.FC<SourceRowProps> = ({
  source,
  isSelected,
  isActive,
  width,
}) => {
  const statusIcon = source.isRejected ? "✘" : source.isFavorited ? "★" : "?";
  const statusColor = source.isRejected
    ? "red"
    : source.isFavorited
      ? "yellow"
      : "gray";
  const display = getDisplay(source.metadata.apiProvider);
  const prefixColor = source.isRejected ? "gray" : display.color;
  const isDimmed = source.isRejected;

  const m = source.metadata;
  const type = m.type
    ? m.type.charAt(0).toUpperCase() + m.type.slice(1)
    : "Track";
  const artist = m.artists[0]?.name ?? "";
  const title = m.trackName ?? "";
  const info = artist ? `${artist} - ${title}` : title;
  const dur = formatDuration(m.duration);
  const prefixParts = [display.label, type, m.id].filter(Boolean);
  const suffix = ` > ${info}${dur ? ` ${dur}` : ""}`;

  const badge = confidenceBadge(source.confidence);
  const focusColorBg = isActive ? "#2a2a2a" : "#131313";
  const bg = isSelected ? focusColorBg : undefined;

  return (
    <Box
      flexDirection="row"
      width={width}
      minWidth={width}
      height={1}
      overflow="hidden"
      backgroundColor={bg}
      flexWrap="nowrap"
      alignItems="flex-start"
      justifyContent="flex-start"
      alignSelf="flex-start"
    >
      <Box width={3} minWidth={3}>
        <Text>{isSelected && isActive ? "☛ " : "  "}</Text>
      </Box>
      <Box width={2} minWidth={2}>
        <Text
          dimColor={isDimmed}
          color={statusColor as string}
          wrap="truncate-end"
        >
          {statusIcon}{" "}
        </Text>
      </Box>
      <Box width={badge.text.length + 1} minWidth={badge.text.length + 1}>
        <Text
          color={badge.color as string}
          dimColor={isDimmed}
          strikethrough={isDimmed}
          wrap="truncate-end"
        >
          {badge.text}{" "}
        </Text>
      </Box>
      <Box
        flexGrow={1}
        overflow="hidden"
        flexDirection="row"
        flexWrap="nowrap"
        alignItems="flex-start"
        justifyContent="flex-start"
        alignSelf="flex-start"
      >
        {prefixParts.map((part, i) => (
          <Box
            key={i}
            width={part.length + (i > 0 ? 3 : 0)}
            minWidth={part.length + (i > 0 ? 3 : 0)}
          >
            {i > 0 && (
              <Text
                color="white"
                dimColor={isDimmed}
                strikethrough={isDimmed}
                wrap="truncate-end"
              >
                {" > "}
              </Text>
            )}
            <Text
              color={prefixColor as any}
              dimColor={isDimmed}
              strikethrough={isDimmed}
              wrap="truncate-end"
            >
              {part}
            </Text>
          </Box>
        ))}
        <Text
          color="white"
          dimColor={isDimmed}
          strikethrough={isDimmed}
          wrap="truncate-end"
        >
          {suffix}
        </Text>
      </Box>
      {isSelected && (
        <Box
          flexDirection="row"
          height={1}
          width={5}
          minWidth={5}
          paddingLeft={1}
          paddingRight={1}
        >
          <Text color="gray" dimColor={isDimmed}>
            {">>>"}
          </Text>
        </Box>
      )}
    </Box>
  );
};

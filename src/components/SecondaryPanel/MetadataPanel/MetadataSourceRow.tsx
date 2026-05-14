import React from "react";
import { Box, Text } from "ink";
import { MetadataSourceState } from "../../../flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "../../../base/providerDisplay";
import { useTheme } from "../../../base/themeContext";
import { Theme } from "../../../base/theme";

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

function confidenceBadge(
  source: MetadataSourceState,
  theme: Theme,
): {
  text: string;
  color: string;
} {
  if (source.isPrimarySource) {
    return { text: "[PRIMARY]", color: theme.confidence.primary };
  }

  const confidence = source.confidence;

  if (confidence === undefined)
    return { text: "[??%]", color: theme.text.secondary };

  const text = `[${confidence.toString()}%]`;

  if (confidence >= 90) return { text, color: theme.confidence.high };
  if (confidence >= 70) return { text, color: theme.confidence.medium };
  if (confidence >= 50) return { text, color: theme.confidence.low };

  return { text, color: theme.confidence.veryLow };
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
  const theme = useTheme();
  const statusIcon = source.isRejected ? "✘" : source.isFavorited ? "★" : "?";
  const statusColor = source.isRejected
    ? theme.status.error
    : source.isFavorited
      ? theme.field.overridden
      : theme.text.secondary;
  const display = getDisplay(source.metadata.apiProvider);
  const prefixColor = source.isRejected ? theme.text.secondary : display.color;
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

  const badge = confidenceBadge(source, theme);
  const focusColorBg = isActive
    ? theme.ui.rowActiveBackground
    : theme.ui.rowBackground;
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
      <Box width={2} minWidth={2} paddingRight={1} flexShrink={0}>
        <Text dimColor={isDimmed} color={statusColor} wrap="truncate-end">
          {statusIcon}
        </Text>
      </Box>
      <Box
        width={badge.text.length + 1}
        minWidth={badge.text.length + 1}
        paddingRight={1}
        flexShrink={0}
      >
        <Text
          color={badge.color}
          dimColor={isDimmed}
          strikethrough={isDimmed}
          wrap="truncate-end"
        >
          {badge.text}
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
            flexShrink={0}
          >
            {i > 0 && (
              <Text
                color={theme.text.primary}
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
          color={theme.text.primary}
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
          <Text color={theme.text.secondary} dimColor={isDimmed}>
            {">>>"}
          </Text>
        </Box>
      )}
    </Box>
  );
};

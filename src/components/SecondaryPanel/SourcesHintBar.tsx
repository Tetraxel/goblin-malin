import React from "react";
import { Box, Text } from "ink";
import { MetadataSourceState } from "../../flows/musicDownloadFlow/types";
import { providerDisplayRegistry } from "../../base/providerDisplay";
import { Hint } from "../Hint";
import { useTheme } from "../../base/themeContext";

interface SourcesHintBarProps {
  sources: MetadataSourceState[];
  selectedIndex: number;
  innerFocus: "list" | "detail";
  isActive: boolean;
  width: number;
}

function getDisplay(apiProvider: string): { label: string; color: string } {
  const display = providerDisplayRegistry.get(apiProvider);
  return { label: display.label, color: display.color };
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

export const SourcesHintBar: React.FC<SourcesHintBarProps> = ({
  sources,
  selectedIndex,
  innerFocus,
  isActive,
  width,
}) => {
  const theme = useTheme();
  const dim = !isActive || innerFocus !== "list";
  const isCompiled = selectedIndex === -1;
  const selectedSource = isCompiled ? null : (sources[selectedIndex] ?? null);

  let row1Parts: { label: string; color: string }[] = [];
  if (!isCompiled && selectedSource) {
    const m = selectedSource.metadata;
    const display = getDisplay(m.apiProvider);
    const type = m.type
      ? m.type.charAt(0).toUpperCase() + m.type.slice(1)
      : "Track";
    const id = m.id ? truncate(m.id, 14) : "";
    row1Parts = [display.label, type, id]
      .filter(Boolean)
      .map((label) => ({ label, color: display.color }));
  }

  const sortedSources = [...sources].sort((a, b) => a.rank - b.rank);
  let row2Left = "";
  if (isCompiled) {
    row2Left = "Compiled Metadata";
  } else if (selectedSource) {
    const pos = sortedSources.indexOf(selectedSource) + 1;
    row2Left = `Source ${pos}/${sources.length}`;
  }

  const showSourceActions = !isCompiled && !!selectedSource;
  const isRejected = selectedSource?.isRejected ?? false;

  return (
    <Box
      flexDirection="column"
      width={width}
      minHeight={1}
      overflow="hidden"
      marginLeft={1}
      alignItems="flex-end"
      justifyContent="flex-end"
    >
      <Box flexDirection="row" width={width} overflow="hidden">
        <Box marginRight={1} flexDirection="row">
          {row1Parts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <Text color={theme.text.active} dimColor={dim}>
                  {" > "}
                </Text>
              )}
              <Text color={part.color} dimColor={dim}>
                {part.label}
              </Text>
            </React.Fragment>
          ))}
        </Box>
        {!isCompiled && row1Parts.length > 0 && (
          <>
            <Box marginRight={2}>
              <Text color={theme.text.active} dimColor={dim}>
                {">>>"}
              </Text>
            </Box>
            <Hint label="Open link" shortcut="Enter" dim={dim} />
            <Hint label="Copy link" shortcut="Ctrl+C" dim={dim} />
            <Hint label="Download" shortcut="D" dim={dim} />
          </>
        )}
      </Box>

      <Box flexDirection="row" width={width} overflow="hidden">
        <Box marginRight={1}>
          <Text color={theme.text.active} dimColor={dim} bold>
            {row2Left}
          </Text>
        </Box>
        {showSourceActions && (
          <>
            <Box marginRight={2}>
              <Text color={theme.text.active} dimColor={dim}>
                {">>>"}
              </Text>
            </Box>
            <Hint
              label={selectedSource?.isFavorited ? "Unfavorite" : "Favorite"}
              shortcut="F"
              dim={dim}
            />
            <Hint
              label={isRejected ? "Unreject" : "Reject source"}
              shortcut="Del"
              dim={dim}
            />
            <Hint label="Move up" shortcut="Shift+↑" dim={dim} />
            <Hint label="Move down" shortcut="Shift+↓" dim={dim} />
          </>
        )}
      </Box>
    </Box>
  );
};

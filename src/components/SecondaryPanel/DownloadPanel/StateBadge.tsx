import React from "react";
import { Text } from "ink";
import { TrackDownloadSource } from "../../../flows/musicDownloadFlow/types";
import { useTheme } from "../../../base/themeContext";

export function StateBadge({ source }: { source: TrackDownloadSource }) {
  const theme = useTheme();
  if (source.savedFile) return <Text color={theme.status.locked}>● SAVED</Text>;
  switch (source.state) {
    case "downloading":
      return <Text color={theme.status.downloading}>DOWNLOADING</Text>;
    case "downloaded":
      return <Text color={theme.status.success}>DOWNLOADED</Text>;
    case "failed":
      return <Text color={theme.status.error}>FAILED</Text>;
    case "searching":
      return <Text color={theme.status.downloading}>SEARCHING</Text>;
    default:
      return <Text color={theme.status.skipped}>PENDING</Text>;
  }
}

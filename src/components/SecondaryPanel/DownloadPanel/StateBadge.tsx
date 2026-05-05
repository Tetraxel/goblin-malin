import React from "react";
import { Text } from "ink";
import { TrackDownloadSource } from "../../../flows/musicDownloadFlow/types";

export function StateBadge({ source }: { source: TrackDownloadSource }) {
  if (source.savedFile) return <Text color="cyan">● SAVED</Text>;
  switch (source.state) {
    case "downloading":
      return <Text color="yellow">DOWNLOADING</Text>;
    case "downloaded":
      return <Text color="green">DOWNLOADED</Text>;
    case "failed":
      return <Text color="red">FAILED</Text>;
    case "searching":
      return <Text color="yellow">SEARCHING</Text>;
    default:
      return <Text color="gray">PENDING</Text>;
  }
}

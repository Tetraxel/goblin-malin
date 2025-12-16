import React from "react";
import open from "open";
import fs from "fs/promises";
import { Text, useInput } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { DownloadTaskAttributes } from "../utils/downloadTask";
import {
  MusicBrainzRecording,
  MusicBrainzRelease,
} from "../../../services/musicbrainz";
import { useFocusContext } from "../../../contexts/FocusContext";

function getBestRelease(
  recording: MusicBrainzRecording
): MusicBrainzRelease | undefined {
  if (!recording.releases || recording.releases.length === 0) {
    return undefined;
  }

  const priorityOrder: Record<string, number> = {
    Album: 1,
    EP: 2,
    Single: 3,
  };

  const releasesWithPriority = recording.releases
    .filter((release) => {
      const primaryType = release["release-group"]?.["primary-type"];
      return primaryType && primaryType in priorityOrder;
    })
    .sort((a, b) => {
      const typeA = a["release-group"]!["primary-type"];
      const typeB = b["release-group"]!["primary-type"];
      return priorityOrder[typeA] - priorityOrder[typeB];
    });

  return releasesWithPriority[0] || recording.releases[0];
}

export const MbCell: ColumnComponent<DownloadTaskAttributes> = ({
  task,
  width,
  isSelected,
}) => {
  const { focusState } = useFocusContext();
  const isActive = focusState.activeWindow === "taskList";
  const track = task.attributes?.track;

  const musicBrainzRecording = track?.musicBrainzRecording;
  const musicBrainzRelease = musicBrainzRecording
    ? getBestRelease(musicBrainzRecording)
    : undefined;

  const musicBrainzRecordingLink = musicBrainzRecording
    ? `https://musicbrainz.org/recording/${musicBrainzRecording.id}`
    : undefined;
  const musicBrainzReleaseLink = musicBrainzRelease
    ? `https://musicbrainz.org/release/${musicBrainzRelease.id}?tport=8000`
    : undefined;

  const mbPicardRecordingLink = musicBrainzRecording
    ? `http://127.0.0.1:8000/opennat?id=${musicBrainzRecording.id}`
    : undefined;
  const mbPicardReleaseLink = musicBrainzRelease
    ? `http://127.0.0.1:8000/openalbum?id=${musicBrainzRelease.id}`
    : undefined;

  const OPEN_IN_PICARD_ENABLED = false;

  useInput(
    async (input, key) => {
      await fs.writeFile(
        "samples/musicBrainzRecording.json",
        JSON.stringify(musicBrainzRecording, null, 2)
      );
      if (key.return) {
        if (OPEN_IN_PICARD_ENABLED) {
          if (mbPicardReleaseLink) await open(mbPicardReleaseLink);
          else if (mbPicardRecordingLink) await open(mbPicardRecordingLink);
        } else {
          if (musicBrainzReleaseLink) await open(musicBrainzReleaseLink);
          else if (musicBrainzRecordingLink)
            await open(musicBrainzRecordingLink);
        }
      }
    },
    { isActive }
  );

  return (
    <Text
      color={
        musicBrainzRecording === undefined
          ? "white"
          : musicBrainzRecording === null
          ? "red"
          : "green"
      }
      underline={isSelected}
      wrap="truncate-end"
    >
      {musicBrainzRecording === undefined
        ? ""
        : musicBrainzRecording === null
        ? "✘"
        : "✔"}
    </Text>
  );
};

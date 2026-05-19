// import React from "react";
// import open from "open";
// import { Text, useInput } from "ink";
// import { ColumnComponent } from "#components/TaskListPanel/TaskListPanel";
// import { MusicBrainzRecording, MusicBrainzRelease } from "./MusicBrainzService";
// import { useFocusContext } from "#contexts/FocusContext";
// import { globalLogger } from "#base/logger/logger";
// import { MusicDownloadTaskAttributes, StandardTrack } from "#flows/musicDownloadFlow/types";

// function getBestRelease(
//   recording: MusicBrainzRecording,
// ): MusicBrainzRelease | undefined {
//   if (!recording.releases || recording.releases.length === 0) {
//     return undefined;
//   }

//   const priorityOrder: Record<string, number> = {
//     Album: 1,
//     EP: 2,
//     Single: 3,
//   };

//   const releasesWithPriority = recording.releases
//     .filter((release) => {
//       const primaryType = release["release-group"]?.["primary-type"];
//       return primaryType && primaryType in priorityOrder;
//     })
//     .sort((a, b) => {
//       const typeA = a["release-group"]!["primary-type"];
//       const typeB = b["release-group"]!["primary-type"];
//       return priorityOrder[typeA] - priorityOrder[typeB];
//     });

//   return releasesWithPriority[0] || recording.releases[0];
// }

// function getSearchTrackLink(
//   track: StandardTrack | undefined,
// ): string | undefined {
//   if (!track) return undefined;

//   const baseUrl = "https://musicbrainz.org/taglookup/index";
//   const params = new URLSearchParams();

//   if (track.artists?.[0]?.name) {
//     params.append("tag-lookup.artist", track.artists[0].name);
//   }
//   if (track.album?.albumName) {
//     params.append("tag-lookup.release", track.album.albumName);
//   }
//   if (track.trackName) {
//     params.append("tag-lookup.track", track.trackName);
//   }
//   if (track.duration) {
//     params.append("tag-lookup.duration", track.duration.toString());
//   }

//   const queryString = params.toString();
//   return queryString ? `${baseUrl}?${queryString}` : undefined;
// }

// export const MusicBrainzCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
//   task,
//   width,
//   isSelected,
// }) => {
//   const track = task.attributes?.track;

//   const musicBrainzRecording = track?.musicBrainzRecording;
//   const musicBrainzRelease = musicBrainzRecording
//     ? getBestRelease(musicBrainzRecording)
//     : undefined;

//   const musicBrainzRecordingLink = musicBrainzRecording
//     ? `https://musicbrainz.org/recording/${musicBrainzRecording.id}?tport=8000`
//     : undefined;
//   const musicBrainzReleaseLink = musicBrainzRelease
//     ? `https://musicbrainz.org/release/${musicBrainzRelease.id}?tport=8000`
//     : undefined;

//   const mbPicardRecordingLink = musicBrainzRecording
//     ? `http://127.0.0.1:8000/opennat?id=${musicBrainzRecording.id}`
//     : undefined;
//   const mbPicardReleaseLink = musicBrainzRelease
//     ? `http://127.0.0.1:8000/openalbum?id=${musicBrainzRelease.id}`
//     : undefined;

//   const searchTrackLink = getSearchTrackLink(track);

//   const OPEN_IN_PICARD_ENABLED = false;

//   // Hook must be called unconditionally, but disabled when column is hidden
//   useInput(
//     async (input, key) => {
//       if (key.return) {
//         if (OPEN_IN_PICARD_ENABLED) {
//           if (mbPicardReleaseLink) await open(mbPicardReleaseLink);
//           else if (mbPicardRecordingLink) await open(mbPicardRecordingLink);
//           else if (searchTrackLink) await open(searchTrackLink);
//         } else {
//           if (musicBrainzReleaseLink) await open(musicBrainzReleaseLink);
//           else if (musicBrainzRecordingLink)
//             await open(musicBrainzRecordingLink);
//           else if (searchTrackLink) await open(searchTrackLink);
//         }
//       }
//     },
//     { isActive: isSelected },
//   );

//   return (
//     <Text
//       color={
//         musicBrainzRecording
//           ? "green"
//           : searchTrackLink
//             ? "yellow"
//             : track
//               ? "red"
//               : "white"
//       }
//       underline={isSelected}
//       wrap="truncate-end"
//     >
//       {musicBrainzRecording
//         ? "🡵 Open"
//         : searchTrackLink
//           ? "🔎 Search"
//           : track
//             ? "✘ Not found"
//             : ""}
//     </Text>
//   );
// };

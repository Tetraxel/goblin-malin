import React from "react";
import { Text } from "ink";
import { type ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export const SoundCloudCell = React.memo(function SoundCloudCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const attrs = task.attributes;
    const group = attrs?.kind === "track" ? attrs.metadataGroups.find((g) => g.serviceKey === "soundcloud") : undefined;
    const metadata = group?.results.find((r) => !r.isRejected)?.metadata;
    // `<user>/<track>`: the track's permalink.
    const id = metadata?.uri?.split("::").pop();

    return (
        <Text color={id ? "green" : "white"} underline={isSelected} wrap="truncate-end">
            {id || ""}
        </Text>
    );
});

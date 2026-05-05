import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { FieldAttribution } from "../../../flows/musicDownloadFlow/utils/compiledMetadata";
import { FieldDef } from "../../../flows/musicDownloadFlow/utils/metadataFields";

const PLATFORM_SUBTLE_COLORS: Record<string, string> = {
  spotify: "#156b30",
  youtube: "#7a1500",
  youtubeMusic: "#7a1500",
  musicBrainz: "#6b1060",
  deezer: "#005570",
  appleMusic: "#505050",
  tidal: "#0030a0",
  soundcloud: "#7a2500",
  itunes: "#505050",
  bandcamp: "#0a5060",
};

function getPlatformColor(apiProvider: string): string {
  return PLATFORM_SUBTLE_COLORS[apiProvider] ?? "#404040";
}

function attributionBadge(attr: FieldAttribution | undefined): {
  text: string;
  color: string;
  italic?: boolean;
} {
  if (!attr) return { text: "", color: "gray" };
  if (attr === "manual")
    return { text: "EDITED", color: "yellow", italic: true };
  if (attr === "none") return { text: "—", color: "gray" };
  return {
    text: `${attr.toUpperCase().slice(0, 8)}`,
    color: getPlatformColor(attr),
  };
}

const LABEL_W = 10;

export interface FieldRowProps {
  field: FieldDef;
  isFocused: boolean;
  isCompiled: boolean;
  isEditing: boolean;
  value: string;
  attribution: FieldAttribution | undefined;
  hasOverride: boolean;
  editValue: string;
  editError: boolean;
  onEditValueChange: (value: string) => void;
  onEditSubmit: (value: string) => void;
}

export const FieldRow: React.FC<FieldRowProps> = ({
  field,
  isFocused,
  isCompiled,
  isEditing,
  value,
  attribution,
  hasOverride,
  editValue,
  editError,
  onEditValueChange,
  onEditSubmit,
}) => {
  const badge = attributionBadge(attribution);

  return (
    <Box
      flexDirection="row"
      paddingX={1}
      flexShrink={0}
      backgroundColor={"blue"}
      flexGrow={1}
    >
      <Box width={2} minWidth={2} flexShrink={0}>
        {isFocused && <Text color="white">{"☛"}</Text>}
      </Box>
      <Box width={LABEL_W} flexShrink={0}>
        <Text color={isFocused ? "green" : "cyan"} bold>
          {field.label.toUpperCase().padEnd(LABEL_W)}
        </Text>
      </Box>

      {isEditing ? (
        <Box flexWrap="wrap" flexDirection="row" flexGrow={1}>
          <TextInput
            value={editValue}
            onChange={onEditValueChange}
            onSubmit={onEditSubmit}
          />
          {editError && <Text color="red"> ✗ invalid</Text>}
        </Box>
      ) : (
        <Box flexGrow={1}>
          <Text
            color={value === "—" ? "gray" : hasOverride ? "yellow" : "white"}
            underline={isFocused}
            dimColor={value === "—"}
            wrap="truncate-end"
          >
            {value}
          </Text>
        </Box>
      )}

      {isCompiled && !isEditing && !editError && (
        <Box minWidth={badge.text.length + 1} paddingLeft={1} flexShrink={0}>
          <Text color={badge.color as any} dimColor italic={badge.italic}>
            {badge.text}
          </Text>
        </Box>
      )}
    </Box>
  );
};

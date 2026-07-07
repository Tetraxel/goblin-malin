import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useTheme } from "#base/themeContext";
import { useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { ToolbarButtonInvoker } from "./ToolbarButtonInvoker";
import { TOOLBAR_BUTTONS } from "./toolbarButtons";
import { Separator } from "../Separator";
import { TabBar } from "../TabBar";
import { UpdateInfo } from "#updater/updateChecker";
import { UpdateBadge } from "./UpdateBadge";
import { useCurrentSessionName } from "./useCurrentSessionName";
import { APP_VERSION } from "#constants";

export type ToolbarButtonHook = ({ isSelected }: { isSelected: boolean }) => {
    enabled: boolean;
    label?: string;
    icon?: string;
    inProgress?: boolean;
    color?: React.ComponentProps<typeof Text>["color"];
    bold?: boolean;
    italic?: boolean;
    onPress?: () => void;
};

export const Toolbar = ({ width, updateInfo }: { width: number; updateInfo?: UpdateInfo | null }) => {
    const theme = useTheme();
    const { activeWindow, toolbar } = useFocusChrome();
    const isActive = activeWindow === "toolbar";
    const height = toolbar.height;
    const currentSessionName = useCurrentSessionName();

    const isScreenSmall = width < 100;
    const name = "😉 " + (isScreenSmall ? "" : "Goblin Malin");
    const nameWidth = stringWidth(name);
    const splitPositions = [nameWidth + 3];

    return (
        <>
            <Separator width={width} type="top" splitPositions={splitPositions} />
            <Box
                borderStyle="single"
                borderColor={theme.ui.border}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
                borderBottom={false}
                paddingX={1}
                overflow="hidden"
                display={"flex"}
                height={height}
                gap={1}
            >
                <Box
                    borderStyle="single"
                    borderColor={theme.ui.border}
                    borderBackgroundColor={theme.ui.background}
                    borderTop={false}
                    borderBottom={false}
                    borderLeft={false}
                    width={nameWidth + 2}
                    minWidth={nameWidth + 2}
                    height={height}
                    overflow="hidden"
                    flexShrink={0}
                >
                    <Text color={theme.action.primary} bold={true}>
                        {name}
                    </Text>
                </Box>

                <Box height={height} marginRight={1} flexGrow={1} flexShrink={0}>
                    {TOOLBAR_BUTTONS.map((hook, index) => {
                        const isSelected = isActive && toolbar.selectedButtonIndex === index;

                        return <ToolbarButtonInvoker key={index} hook={hook} isSelected={isSelected} index={index} />;
                    })}
                </Box>

                <Box
                    flexDirection={"row"}
                    display={"flex"}
                    justifyContent="flex-end"
                    gap={1}
                    height={height}
                    flexShrink={1}
                >
                    {currentSessionName && !isScreenSmall && (
                        <>
                            <Text color={theme.text.heading} bold={true} wrap="truncate-end">
                                {currentSessionName}
                            </Text>
                            <Text dimColor>·</Text>
                        </>
                    )}
                    {updateInfo ? (
                        <UpdateBadge
                            version={updateInfo.latestVersion}
                            isSelected={isActive && toolbar.selectedButtonIndex === TOOLBAR_BUTTONS.length}
                            index={TOOLBAR_BUTTONS.length}
                        />
                    ) : (
                        <Text dimColor>v{APP_VERSION}</Text>
                    )}
                </Box>
            </Box>
            <PrimaryModeTabBar width={width} splitPos={splitPositions[0] ?? 0} />
        </>
    );
};

const PrimaryModeTabBar: React.FC<{ width: number; splitPos: number }> = ({ width, splitPos }) => {
    const { primaryMode } = useFocusSecondaryPanel();

    return (
        <TabBar
            width={width}
            tabs={[
                { key: "1", label: "Metadata view" },
                { key: "2", label: "Download view" },
            ]}
            activeTabKey={primaryMode === "metadata" ? "1" : "2"}
            splitPos={splitPos}
        />
    );
};

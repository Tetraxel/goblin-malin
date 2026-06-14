import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { FlowBase } from "#base/flow/flow-base";
import { useTheme } from "#base/themeContext";
import { useFocusContext } from "#contexts/FocusContext";
import { ToolbarButtonInvoker } from "./ToolbarButtonInvoker";
import { FlowSelector } from "./FlowSelector";
import { Separator } from "../Separator";
import { TabBar } from "../TabBar";
import { UpdateInfo } from "#updater/updateChecker";
import { UpdateBadge } from "./UpdateBadge";
import { APP_VERSION } from "#constants";

export type ToolbarButtonHook<TFlow = FlowBase> = ({
    isSelected,
    flow,
    orchestrator,
}: {
    isSelected: boolean;
    flow: TFlow;
    orchestrator: FlowOrchestrator;
}) => {
    enabled: boolean;
    label?: string;
    icon?: string;
    color?: React.ComponentProps<typeof Text>["color"];
    bold?: boolean;
    italic?: boolean;
    onPress?: () => void;
};

export const Toolbar = ({
    buttons,
    width,
    flows,
    onFlowChange,
    flow,
    orchestrator,
    updateInfo,
}: {
    buttons: ToolbarButtonHook[];
    width: number;
    flows: ReturnType<FlowOrchestrator["getAllFlows"]>;
    onFlowChange: (flowId: string) => void;
    flow: FlowBase;
    orchestrator: FlowOrchestrator;
    updateInfo?: UpdateInfo | null;
}) => {
    const theme = useTheme();
    const { focusState } = useFocusContext();
    const isActive = focusState.activeWindow === "toolbar";
    const height = focusState.toolbar.height;

    const name = "😉 " + (width > 90 ? "Goblin Malin" : "");
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
            >
                <Box
                    borderStyle="single"
                    borderColor={theme.ui.border}
                    borderBackgroundColor={theme.ui.background}
                    borderTop={false}
                    borderBottom={false}
                    borderLeft={false}
                    marginRight={1}
                    width={nameWidth + 2}
                    minWidth={nameWidth + 2}
                    height={height}
                    overflow="hidden"
                >
                    <Text color={theme.action.primary} bold={true}>
                        {name}
                    </Text>
                </Box>

                {buttons.map((hook, index) => {
                    const isSelected = isActive && focusState.toolbar.selectedButtonIndex === index;

                    return (
                        <ToolbarButtonInvoker
                            key={index}
                            hook={hook}
                            isSelected={isSelected}
                            index={index}
                            flow={flow}
                            orchestrator={orchestrator}
                        />
                    );
                })}

                <Box
                    flexDirection={"row"}
                    display={"flex"}
                    flexGrow={1}
                    justifyContent="flex-end"
                    gap={1}
                    height={height}
                >
                    {/* <FlowSelector flows={flows} currentFlow={flow} onFlowChange={onFlowChange} /> */}
                    {updateInfo ? (
                        <UpdateBadge
                            version={updateInfo.latestVersion}
                            isSelected={isActive && focusState.toolbar.selectedButtonIndex === buttons.length}
                            index={buttons.length}
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
    const { focusState } = useFocusContext();
    const { primaryMode } = focusState.secondaryPanel;

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

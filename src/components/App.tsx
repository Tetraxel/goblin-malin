import fs from "fs/promises";
import React, { useReducer } from "react";
import { Box, useInput, Text } from "ink";
import Spinner from "ink-spinner";
import open from "open";
import { LogPanel } from "./LogPanel";
import { Footer } from "./Footer";
import { Separator } from "./Separator";
import { PromptModal } from "./PromptModal";
import { Toolbar, ToolbarButton } from "./Toolbar";
import { AnimatedIcon, Icon } from "./AnimatedIcon";
import { ColumnDefinition, TaskListPanel } from "./TaskListPanel";
import downloadOrchestrator from "../download-orchestrator";
import { globalLogger } from "../base/logger/logger";
import { StatusAttributes, StatusType } from "../base/task/task-status";
import { useScreenSize } from "../hooks/useScreenSize";
import { useFocusManager } from "../hooks/useFocusManager";
import { FocusProvider, useFocusContext } from "../contexts/FocusContext";
import { DownloadTaskAttributes } from "../flows/musicDownloadFlow/utils/downloadTask";
import { MusicDownloadFlow } from "../flows/musicDownloadFlow/musicDownloadFlow";
import {
  MusicBrainzRecording,
  MusicBrainzRelease,
} from "../services/musicbrainz";
import { cache } from "../utils/cache";
import inputLoader from "../utils/input-loader";
import { ItemsActionType, tasksReducer } from "../reducer";

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

export const App: React.FC = () => {
  const [tasks, dispatch] = useReducer(tasksReducer, []);
  const { height: terminalHeight, width: terminalWidth } = useScreenSize();

  const startProcessing = async () => {
    try {
      const tasks = await inputLoader.loadFromFile("inputs.txt");
      dispatch({ type: ItemsActionType.SET_TASKS, payload: tasks });
      downloadOrchestrator.setMaxConcurrent(3);
      downloadOrchestrator.addToQueue(tasks);
      await downloadOrchestrator.startProcessing();
    } catch (error) {
      globalLogger.error(`Failed to load inputs`, { error });
    }
  };

  const flows: any[] = [
    {
      id: "music-downloader",
      displayName: "Music Downloader",
      author: "Tetraxel",
      classReference: MusicDownloadFlow,
    },
    {
      id: "youtube-downloader",
      displayName: "Youtube Downloader",
      author: "Tetraxel",
      classReference: null,
    },
  ];

  const toolbarButtons: ToolbarButton[] = [
    {
      label: "Run All",
      icon: "▶",
      color: "green",
      bold: true,
      hook: ({ isSelected }: { isSelected: boolean }) => {
        useInput(
          (input, key) => {
            if (key.return) {
              startProcessing();
            }
          },
          { isActive: isSelected }
        );
        return { enabled: true };
      },
    },
    {
      label: "Stop All",
      icon: "◼",
      color: "red",
      hook: () => ({ enabled: true }),
    },
    {
      label: "Settings",
      icon: "⚙",
      color: "gray",
      hook: () => ({ enabled: true }),
    },
    {
      label: "Exit",
      icon: "🚪",
      color: "red",
      hook: ({ isSelected }: { isSelected: boolean }) => {
        useInput(
          (input, key) => {
            if (key.return) {
              process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
              console.info("Saving cache before exit...");
              cache.save();
              process.exit(0);
            }
          },
          { isActive: isSelected }
        );
        return { enabled: true };
      },
    },
  ];

  const columns: ColumnDefinition<DownloadTaskAttributes>[] = [
    {
      label: "URL",
      weight: 35,
      flexGrow: 0,
      render: ({ task, width, isSelected }) => {
        const track = task.attributes?.track;
        const url = track?.uri ?? track?.url ?? task.initialInput ?? "";

        return (
          <Text
            color={isSelected ? "green" : "white"}
            underline={isSelected}
            wrap="truncate-end"
          >
            {url}
          </Text>
        );
      },
    },
    {
      label: "MB",
      weight: 1,
      flexGrow: 0,
      render: ({ task, width, isSelected }) => {
        const { focusState, ...focusManager } = useFocusContext();
        const isActive = focusState.activeWindow === "taskList";
        const track = task.attributes?.track;

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

          // Filter releases that have a valid primary-type and sort by priority
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

          // Return the best release, or if none match criteria, return the first available release
          return releasesWithPriority[0] || recording.releases[0];
        }

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
                else if (mbPicardRecordingLink)
                  await open(mbPicardRecordingLink);
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
      },
    },
    {
      label: "ARTIST",
      weight: 16,
      flexGrow: 0,
      render: ({ task, width, isSelected }) => {
        const artist = task.attributes?.track?.artists?.[0]?.name || "";

        return (
          <Text
            color={isSelected ? "green" : "white"}
            underline={isSelected}
            wrap="truncate-end"
          >
            {artist}
          </Text>
        );
      },
    },
    {
      label: "TRACK",
      weight: 30,
      flexGrow: 0,
      render: ({ task, width, isSelected }) => {
        const trackName = task.attributes?.track?.trackName || "";

        return (
          <Text
            color={isSelected ? "green" : "white"}
            underline={isSelected}
            wrap="truncate-end"
          >
            {trackName}
          </Text>
        );
      },
    },
    {
      label: "STATUS",
      weight: 28,
      minWidth: 20,
      flexGrow: 0,
      render: ({ task, width, isSelected }) => {
        function getStatusIcon(status: StatusType): React.ReactNode {
          switch (status) {
            case StatusType.Pending:
              return <AnimatedIcon icon={Icon.Hourglass} />;
            case StatusType.PendingUserAction:
              return <AnimatedIcon icon={Icon.Warning} />;
            case StatusType.Skipped:
              return <Text>⏭️</Text>;
            case StatusType.Locked:
              return <Text>🔒</Text>;
            case StatusType.Error:
              return <Text>❌</Text>;
            case StatusType.Success:
              return <Text>✅</Text>;
            case StatusType.Default:
            case StatusType.Processing:
            default:
              return <Spinner type="dots" />;
          }
        }

        function getStatusColor(status: StatusType): string {
          switch (status) {
            case StatusType.Default:
              return "blue";
            case StatusType.Processing:
              return "blue";
            case StatusType.Pending:
              return "white";
            case StatusType.PendingUserAction:
              return "yellow";
            case StatusType.Skipped:
              return "gray";
            case StatusType.Locked:
              return "whiteBright";
            case StatusType.Error:
              return "red";
            case StatusType.Success:
              return "green";
            default:
              return "gray";
          }
        }

        const getStatusText = (status: StatusAttributes): string => {
          let statusMessage = status.message ?? "N/A";
          if (status.timeTracking && status.startTime) {
            const elapsedMs = new Date().getTime() - status.startTime.getTime();
            const elapsedSec = Math.floor(elapsedMs / 1000);
            const minutes = Math.floor(elapsedSec / 60);
            const seconds = elapsedSec % 60;
            const elapsedStr =
              minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
            statusMessage = `${statusMessage} (${elapsedStr})`;
          }

          return statusMessage;
        };

        const statusColor = getStatusColor(task.status.type);
        const statusText = getStatusText(task.status);
        const iconComponent = getStatusIcon(task.status.type);

        return (
          <Box overflow="hidden">
            <Box marginRight={2}>{iconComponent}</Box>
            <Text
              color={statusColor}
              wrap="truncate-end"
              underline={isSelected}
            >
              {statusText}
            </Text>
          </Box>
        );
      },
    },
  ];

  const focusManager = useFocusManager({
    toolbarButtonCount: toolbarButtons.length,
    taskCount: tasks.length,
    taskColumnCount: columns.length,
    logCount: 0, // TODO: Move logs to <App/> with filters (logs.length)
  });

  // Global shortcuts
  useInput((input, key) => {
    if (key.tab) {
      focusManager.handleTabPress();
      return;
    }
  });

  return (
    <FocusProvider value={focusManager}>
      <Box flexDirection="column" height={terminalHeight}>
        <Toolbar buttons={toolbarButtons} width={terminalWidth} />
        <TaskListPanel columns={columns} tasks={tasks} width={terminalWidth} />
        <Separator width={terminalWidth} />
        <LogPanel />
        <Separator width={terminalWidth} />
        <Footer />

        {/* Prompt Modal - renders on top when a prompt is active */}
        <PromptModal
          tasks={tasks}
          terminalHeight={terminalHeight}
          terminalWidth={terminalWidth}
        />
      </Box>
    </FocusProvider>
  );
};

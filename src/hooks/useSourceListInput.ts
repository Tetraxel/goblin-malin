import { useInput } from "ink";
import open from "open";
import clipboard from "clipboardy";
import { MetadataSourceState } from "../flows/musicDownloadFlow/types";

interface UseSourceListInputParams {
  sources: MetadataSourceState[];
  sortedSources: MetadataSourceState[];
  selectedIndex: number;
  isActive: boolean;
  onSelectSource: (index: number) => void;
  onInnerFocusSwitch: () => void;
  onSourcesChange: (sources: MetadataSourceState[]) => void;
}

function toOpenableUri(url: string): string {
  const m = url.match(
    /open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/,
  );
  if (m) return `spotify:${m[1]}:${m[2]}`;
  return url;
}

export function useSourceListInput({
  sources,
  sortedSources,
  selectedIndex,
  isActive,
  onSelectSource,
  onInnerFocusSwitch,
  onSourcesChange,
}: UseSourceListInputParams) {
  useInput(
    (input, key) => {
      if (key.upArrow) {
        if (key.shift) {
          // [Shift+↑] — move up in rank (swap with source above)
          if (selectedIndex < 0) return;
          const source = sources[selectedIndex];
          const sortedIdx = sortedSources.indexOf(source);
          if (sortedIdx <= 0) return;
          const above = sortedSources[sortedIdx - 1];
          const updated = sources.map((s) => {
            if (s === source) return { ...s, rank: above.rank };
            if (s === above) return { ...s, rank: source.rank };
            return s;
          });
          onSourcesChange(updated);
          return;
        }
        if (selectedIndex === -1) return;
        const sortedIdx = sortedSources.findIndex(
          (s) => sources.indexOf(s) === selectedIndex,
        );
        if (sortedIdx <= 0) {
          onSelectSource(-1);
        } else {
          onSelectSource(sources.indexOf(sortedSources[sortedIdx - 1]));
        }
        return;
      }

      if (key.downArrow) {
        if (key.shift) {
          // [Shift+↓] — move down in rank (swap with source below)
          if (selectedIndex < 0) return;
          const source = sources[selectedIndex];
          const sortedIdx = sortedSources.indexOf(source);
          if (sortedIdx >= sortedSources.length - 1) return;
          const below = sortedSources[sortedIdx + 1];
          const updated = sources.map((s) => {
            if (s === source) return { ...s, rank: below.rank };
            if (s === below) return { ...s, rank: source.rank };
            return s;
          });
          onSourcesChange(updated);
          return;
        }
        if (selectedIndex === -1) {
          if (sortedSources.length > 0)
            onSelectSource(sources.indexOf(sortedSources[0]));
        } else {
          const sortedIdx = sortedSources.findIndex(
            (s) => sources.indexOf(s) === selectedIndex,
          );
          if (sortedIdx < sortedSources.length - 1) {
            onSelectSource(sources.indexOf(sortedSources[sortedIdx + 1]));
          }
        }
        return;
      }

      // Guard: plain → only (Shift+→ is reserved for panel resize)
      if (key.rightArrow && !key.shift) {
        onInnerFocusSwitch();
        return;
      }

      // [Enter] — open source URL (Spotify → desktop app via spotify: URI)
      if (key.return && selectedIndex >= 0) {
        const url = sources[selectedIndex]?.metadata.url;
        if (url) open(toOpenableUri(url)).catch(() => {});
        return;
      }

      // [Ctrl+C] — copy source URL to clipboard
      if (key.ctrl && input === "c" && selectedIndex >= 0) {
        const url = sources[selectedIndex]?.metadata.url;
        if (url)
          try {
            clipboard.writeSync(url);
          } catch {}
        return;
      }

      // [F] — favorite/unfavorite
      if (input === "f" || input === "F") {
        if (selectedIndex < 0) return;
        const source = sources[selectedIndex];
        if (!source) return;
        const newFavorite = !source.isFavorited;
        const currentPlatform = source.metadata.platform;
        const updated = sources.map((s, i) => {
          if (s.metadata.platform === currentPlatform) {
            return {
              ...s,
              isRejected: false,
              isFavorited: i === selectedIndex ? newFavorite : false,
            };
          }
          return s;
        });
        onSourcesChange(updated);
        return;
      }

      // [Del] — reject/unreject
      if (key.delete) {
        if (selectedIndex < 0) return;
        const source = sources[selectedIndex];
        if (!source) return;
        const isRejected = !source.isRejected;
        const updated = [...sources];
        updated[selectedIndex] = {
          ...source,
          isRejected,
          isFavorited: isRejected ? false : source.isFavorited,
        };
        onSourcesChange(updated);
        return;
      }
    },
    { isActive },
  );
}

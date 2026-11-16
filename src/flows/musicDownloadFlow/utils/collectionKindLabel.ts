import { type CollectionDownloadTask } from "../types";

/** The tag shown in front of a collection's name in the list: `[ALBUM]`, `[PLAYLIST]`, `[GROUP]`. */
export function collectionKindLabel(kind: CollectionDownloadTask["collectionKind"]): string {
    return kind === "album" ? "ALBUM" : kind === "group" ? "GROUP" : "PLAYLIST";
}

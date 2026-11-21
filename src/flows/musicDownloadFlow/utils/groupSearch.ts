import { type MetadataGroupState } from "#flows/musicDownloadFlow/types";

/** The group with its search state set, or removed (`undefined`: it ran and answered). A new object, never a patch. */
export function withSearch(group: MetadataGroupState, search: MetadataGroupState["search"]): MetadataGroupState {
    const next = { ...group };
    if (search) next.search = search;
    else delete next.search;
    return next;
}

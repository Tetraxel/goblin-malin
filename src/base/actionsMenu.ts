/**
 * The toolbar's "Actions" menu: things the user can do to the whole list rather than to one task ("open every track
 * in MusicBrainz Picard"). Generic infrastructure — the menu knows nothing about music; the app registers its items
 * once, in `initMusicApp()`, and the menu (`src/components/ActionsMenu`) renders whatever is registered.
 */
export interface ActionsMenuItem {
    /** Stable name; registering the same id again replaces the item. */
    id: string;
    label: string;
    /** One line under the label: what choosing it does, and what it needs. */
    description: string;
    /**
     * Why the item cannot be used right now ("No track has a MusicBrainz match yet"), or `undefined` when it can. Read
     * every time the menu opens, never cached. The row stays visible (greyed, with the reason) so the user knows
     * the action exists.
     */
    unavailableReason?: () => string | undefined;
    /** Runs the action after the menu closed. A failure is logged by the menu, never thrown at the key handler. */
    run: () => void | Promise<void>;
}

class ActionsMenuRegistry {
    private items: ActionsMenuItem[] = [];

    register(item: ActionsMenuItem): void {
        const at = this.items.findIndex((existing) => existing.id === item.id);
        if (at === -1) this.items.push(item);
        else this.items[at] = item;
    }

    /** The items in the order they were registered. */
    list(): readonly ActionsMenuItem[] {
        return this.items;
    }

    /** For tests. */
    clear(): void {
        this.items = [];
    }
}

export const actionsMenuRegistry = new ActionsMenuRegistry();

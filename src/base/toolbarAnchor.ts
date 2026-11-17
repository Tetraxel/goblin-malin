/**
 * Where the toolbar button that was pressed last sits on the screen, so a menu that drops down from a button
 * (`ActionsMenu`) can open right under it. Set by the toolbar when a button is activated (by mouse or keyboard), read
 * by the menu when it renders; never subscribed to, since the menu is only drawn after the press that set it.
 */
export type ToolbarAnchor = { x: number; y: number; width: number; height: number };

let anchor: ToolbarAnchor | null = null;

export const toolbarAnchor = {
    set(bounds: ToolbarAnchor | null): void {
        anchor = bounds;
    },
    get(): ToolbarAnchor | null {
        return anchor;
    },
};

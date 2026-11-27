/**
 * Which tasks the user has selected in the list, for plain-TypeScript code (an extension's action, P34): the ids
 * multi-selected, else the task under the cursor. The UI publishes a getter once; reading it costs no render.
 */
let read: () => string[] = () => [];

export const taskSelectionBridge = {
    publish(getter: () => string[]): void {
        read = getter;
    },
    current(): string[] {
        try {
            return read();
        } catch {
            return [];
        }
    },
};

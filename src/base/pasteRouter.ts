/**
 * Who gets the text the user pastes.
 *
 * Most terminals (Windows Terminal, iTerm…) catch Ctrl+V themselves and type the clipboard into the app as ordinary
 * input, so the app never sees a "Ctrl+V" key: it sees a chunk of text. By default a pasted link opens the import
 * dialog. A part of the screen that has its own use for a pasted link — "add this link to THIS track" — registers a
 * handler while it is focused; the most recently registered one that claims the text (returns true) wins, and the
 * import dialog only opens when nobody does.
 */
export type PasteHandler = (text: string) => boolean;

const handlers: PasteHandler[] = [];

export const pasteRouter = {
    /** Registers a handler; returns the function that removes it. Later registrations are asked first. */
    register(handler: PasteHandler): () => void {
        handlers.push(handler);
        return () => {
            const i = handlers.lastIndexOf(handler);
            if (i !== -1) handlers.splice(i, 1);
        };
    },
    /** Offers `text` to the handlers, newest first. True when one of them took it. */
    route(text: string): boolean {
        for (let i = handlers.length - 1; i >= 0; i--) {
            try {
                if (handlers[i](text)) return true;
            } catch {
                /* a broken handler must never swallow the paste: the next one (or the import) gets it */
            }
        }
        return false;
    },
};

/**
 * A provider cannot be used right now because of a choice the user made (a tool it needs is switched off), not
 * because something went wrong. Callers read it generically: a link found by discovery that its platform cannot
 * read this way stays a bare link, with no "failed" mark on it.
 */
export class ProviderUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ProviderUnavailableError";
    }
}

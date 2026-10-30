/**
 * A provider could not read an album/playlist, for a reason the user can act on (e.g. a private
 * playlist behind an API that only sees public content). `hint` is the user-facing explanation;
 * the CollectionTask shows it once in a dialog the user can silence for good.
 */
export class CollectionAccessError extends Error {
    constructor(
        message: string,
        readonly hint: string
    ) {
        super(message);
        this.name = "CollectionAccessError";
    }
}

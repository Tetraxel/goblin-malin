/**
 * The numbers that decide how sure the app has to be. They live in one file on purpose: changing one is a decision
 * about the risk of writing a wrong MusicBrainz ID into a library, and is covered by tests (`musicBrainzResolver`).
 */

/** A release search result below this score is not even a candidate. (MusicBrainz scores run 0–100.) */
export const SEARCH_MIN_SCORE = 90;

/** How many releases / artists a search is asked for. More only adds noise to a review. */
export const SEARCH_LIMIT = 5;

/** A MusicBrainz release id is a UUID; anything else coming back from the editor is ignored. */
export const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

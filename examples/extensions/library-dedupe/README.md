# Library dedupe

A sample [Goblin Malin extension](../../../docs/extensions.md).

- **Actions → "Remove tracks already in my library"**: asks for a folder of yours, reads the tags of its audio files, and offers to remove from the list the tracks found there (same ISRC, else same artist and title, durations within 3 s). Tracks already saved by the app are left alone.
- **A Claude tool**, `library_dedupe__find_owned`: the chat can answer "which of these do I already have?" (it only reads).

Settings (Settings → Extensions): the library folder, and whether to compare durations (slower: every file is probed).

Try it: `goblin-malin --extension examples/extensions/library-dedupe` · install it: `goblin-malin ext add examples/extensions/library-dedupe`

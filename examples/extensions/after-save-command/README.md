# After-save command

A sample [Goblin Malin extension](../../../docs/extensions.md): runs a command line of yours for every saved track.

Set the command in Settings → Extensions, for example:

- `beet import -q {path}` (import into [beets](https://beets.io))
- `rsync -a {path} nas:/music/`
- `python3 ~/after-save.py` (reads the whole event as JSON on stdin)

Placeholders: `{path}` `{dir}` `{file}` `{artist}` `{title}` `{album}` `{isrc}` `{format}`, each quoted for the shell. The command runs without the app's credentials in its environment, is killed when the app closes, and after its time limit (a setting). Its last lines of output go to the log.

Try it: `goblin-malin --extension examples/extensions/after-save-command`

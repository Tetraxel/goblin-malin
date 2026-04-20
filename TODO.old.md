# TODO

## 🔴 Release Blocker:

- [ ] Handle this basic flow: Spotify -> Youtube -> Ytdlp
- [ ] Status per service (Spotify, Ytdlp, etc...) instead of per task
- [ ] Set metadata artist/track/MusicBrainzReleaseId
- [ ] Fix prompt runExclusive
- [x] Fix Prompt input not handled anymore
- [x] Fix `Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.`

## 🔵 Release backlog

- [ ] Handling of **Soudcloud** links
- [ ] Add **Soulseek** download
- [ ] Add a button `Open all in MB Picard`
- [ ] Handle Spotify albums as input
- [ ] Handle Spotify playlists as input

## 🟡 Nice to have

- [ ] Resolution Table: See diffs between sources, choose the right result for a specific platform
  ```
  ☒ Youtube: Thing - That (3:00)
  ☐ Youtube: Thierry Lardon - Thing or That is it? (3:00)
  ☐ Spotify: Thing - That (3:00)
  ```
- [ ] Easier cookies.txt extraction for yt-dlp (drag and drop ? step by step instructions?)
- [ ] Drag and drop the desired folder
- [ ] Save the tasks into the disk
- [ ] Handle settings and save into the disk
- [ ] Copy/Edit cell values
- [ ] Be able to open Spotify link after analysis
- [ ] Input management hints `[Enter] https://musicbrainz.org/...`
- [ ] Parse links before calling SongLink to better display them
- [ ] Button to rerun a task without using the cache
- [ ] Optional logging output to a file

## 💡 Future Ideas

- [ ] Be able to see the source of the downloaded file
- [ ] Be able to see the source of the track metadata
- [ ] Tracking of each step of the analysis with the ability to rollback to any step

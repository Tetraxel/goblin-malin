# goblin-malin

Manage your music downloads in a minimalist terminal UI

## Next tasks

- [ ] Improve Soulseek download with progress bar
- [ ] Improve Soulseek to download in background
- [ ] Have logs per url
- [ ] Have a decorator `@Retry` if exception is raised that disconnect client

## Goal

The goal of this project is to

### 1. Take as input a list of musics links and query in a file all the name

For example:

```json
{
  "title": "Elevator Music", // track title
  "artist": "Bobbing", // first artist of the music
  "linksByPlatform": {
    "appleMusic": {
      "url": "<https://music.apple.com/us/album/kitchen/1443108737?i=1443109064&uo=4&app=music&ls=1&at=1000lHKX>",
      "nativeAppUriMobile": "music://music.apple.com/us/album/kitchen/1443108737?i=1443109064&uo=4&app=music&ls=1&at=1000lHKX",
      "nativeAppUriDesktop": "itms://music.apple.com/us/album/kitchen/1443108737?i=1443109064&uo=4&app=music&ls=1&at=1000lHKX",
      "entityUniqueId": "ITUNES_SONG::1443109064"
    },
    "spotify": {
      "url": "<https://open.spotify.com/track/0Jcij1eWd5bDMU5iPbxe2i>",
      "nativeAppUriDesktop": "spotify:track:0Jcij1eWd5bDMU5iPbxe2i",
      "entityUniqueId": "SPOTIFY_SONG::0Jcij1eWd5bDMU5iPbxe2i"
    },
    "youtube": {
      "url": "<https://www.youtube.com/watch?v=w3LJ2bDvDJs>",
      "entityUniqueId": "YOUTUBE_VIDEO::w3LJ2bDvDJs"
    }
  }
}
```

## Steps

1. Input in `urls.txt`
   1. Spotify
      1. track link: `https://open.spotify.com/intl-fr/track/1eh2EPeKP4jjxvRXUF4nPm?si=9ee2645ec2884278`
   2. Youtube
      1. track link: `https://music.youtube.com/watch?v=LxsT5bYUhbM?si=9ee2645ec2884278`
      2. video link: `https://www.youtube.com/watch?v=LYtFacwL4hg&list=PLKlunKCBbRIKbAPwFD-RG_2VCjIug7y_x&index=4&pp=gAQBiAQB`
   3. Soundcloud
      1. track link `https://soundcloud.com/ytsadey/jacqueskickcesoitremix?in=tetraxel/sets/musique/`
2. Use `https://api.song.link` to retrieve related links _(max 10 requests per minute, so you can cache requests already done)_
3.

Input `inputs.txt`:

```txt
https://open.spotify.com/intl-fr/track/2BWIDTVln2LvwGpJ5BYyJD?si=bb321fc5201f45ed
https://open.spotify.com/playlist/3cveC7IxGMsDwOA8Gi1N7P?si=e4e9f22aefc549a0
https://soundcloud.com/hbzmusik/cro-traum-hbz-remix Artist name example - Track title example
https://music.youtube.com/watch?v=Cv1DlkSSjIQ
https://www.youtube.com/watch?v=OXYj8CtIS0c
```

Routines for each links from `links.txt`:

1. ✅ SET METADATA TO FILE
   1. `cleanAndTagFlac`
2. 🔵 SPOTIFY DOWNLOAD
   1. SPOTIFY SOULSEEK DOWNLOAD
      1. Extract `Spotify track URI` from `Spotify track link`
      2. Get `Spotify album` from `Spotify track URI`
      3. Download music file with SOULSEEK (`artistName`, `trackTitle`, `albumName`, 'flac')
      4. Run `SET METADATA TO FILE`
3. 📥 YTDLP DOWNLOAD
   1. Download music file with YTDLP
   2. Run `SET METADATA TO FILE`
4. MAIN
   1. URL DOWNLOAD
      1. Search Songlink track
         1. GET SongLink (`artistName`, `trackTitle`)
         2. Get `Spotify track link`
            1. RUN `1. SPOTIFY SOULSEEK DOWNLOAD`
            2. Else next
         3. or Get `Soundcloud track URI`
            1. RUN `2. YTDLP DOWNLOAD`
         4. or Get `Youtube Music track URI`
            1. RUN `2. YTDLP DOWNLOAD`
         5. or Get `Youtube video URI`
            1. RUN `2. YTDLP DOWNLOAD`
         6. Else throw
   2. Search MUSICBRAINZ album or track to know if can be marked as SUCCESS

Output for each links in `results.txt`:

1. Success
   ```yaml
   fileDownload: "SUCCESS: filename.flac - "
   ```

convertSpotifyLinkToAlbum
Input Spotify track URL

1. Get Spotify track
2. Get Spotify release from the track
3. Get Songlink Info
4. Construct Atisket URL and Save
5. Display Songlink Results

Soulseek

1. ⚠️ check after that duration match or longer

## Misc

### Documentation for api.song.link

https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741

### Downloading Videos with yt-dlp

```bash
./bin/yt-dlp_2025.12.08.exe -x -o "downloads/%(uploader|Unknown)s - %(title)s.%(ext)s" --audio-format flac "https://soundcloud.com/ninajirachi/fmc-fc"
```

```bash
./bin/yt-dlp_2025.12.08.exe  --ffmpeg-location "./bin/ffmpeg_2025-12-26.exe" --cookies "./bin/cookies.txt" --batch-file "soundcloud.txt" -x -o "downloads/%(uploader|Unknown)s - %(title)s.%(ext)s" --audio-format "flac" -f "bestaudio"
```

```bash
yt-dlp --download-archive archive.txt --batch-file urls.txt -x -o "dl/%(uploader|Unknown)s - %(title)s.%(ext)s" --audio-format flac
```

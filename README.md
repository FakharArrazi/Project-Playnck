# Playnck

Playnck is a free desktop music player for Windows and Linux, built around the music files you already have: library management, metadata editing, automatic tagging, synced lyrics, a 10-band equalizer, playlists, and audio conversion.

<img src="docs/screenshots/Home.png" alt="Playnck home screen with library stats, recently played songs, and the Now Playing panel with visualizer" width="100%">

**[Download](https://github.com/FakharArrazi/Project-Playnck/releases/latest)** · **[Releases](https://github.com/FakharArrazi/Project-Playnck/releases)** · **[Source code](https://github.com/FakharArrazi/Project-Playnck)** · **[Telegram](https://t.me/+taM7DL_CKsViNGM0)**

<br>

- Windows 10/11 and Linux (`.deb`, `.rpm`), 64-bit
- Plays local files, no account and no subscription
- Metadata edits are written back into the files
- Auto-Tag with audio fingerprinting
- Synced lyrics
- 10-band equalizer and live visualizer
- Audio conversion with batch support
- Playlists, playlist folders, and listening history
- Themes, accent colors, English and French

<br>
<br>

## Music Library

Browse every song in your library with search, sorting, and multi-select, and play from the list.

<img src="docs/screenshots/Library.png" alt="Songs view with search, sort, and select controls beside the Now Playing panel" width="100%">

<br>
<br>

## Albums

Browse albums as a cover grid, then open one to see its tracks and play them.

<img src="docs/screenshots/Albums.png" alt="Albums grid with cover art" width="100%">

<br>

<img src="docs/screenshots/Inside%20album.png" alt="Album detail page with track list" width="100%">

<br>
<br>

## Artists

Artists are listed with song counts. Open one to see their albums and songs on a single page.

<img src="docs/screenshots/Artists.png" alt="Artists list with artist photos and song counts" width="100%">

<br>

<img src="docs/screenshots/Inside%20artist.png" alt="Artist detail page with albums and songs" width="100%">

<br>
<br>

## Genres

Browse the library by genre, with a card for each one and a detail view for its songs.

<img src="docs/screenshots/Genres.png" alt="Genres view with a card for each genre" width="100%">

<br>
<br>

## Playlists

Create playlists, group them into folders, and export them as `.m3u8`. Favorites are kept in their own playlist.

<img src="docs/screenshots/Playlists.png" alt="Playlists view with a New Playlist button and a Favorites playlist" width="100%">

<br>
<br>

## Folders

Add folders from your computer and Playnck keeps the library in sync with them.

<img src="docs/screenshots/Folders.png" alt="Folders view listing the music folders added to the library" width="100%">

<br>
<br>

## Playback

Shuffle, repeat, a queue, and gapless playback with crossfade. The Now Playing panel stays on screen with a live visualizer, and a sleep timer is built in. Hardware media keys are supported.

<img src="docs/screenshots/Audio.png" alt="Audio settings showing the 10-band equalizer with presets and gapless playback" width="100%">

<br>

- 10-band equalizer with presets and manual adjustment
- Crossfade and gapless playback
- Sleep timer

<img src="docs/screenshots/Sleep%20timer.png" alt="Sleep timer dialog" width="100%">

<br>
<br>

## Metadata Editing

Edit the metadata stored directly in your music files.

<img src="docs/screenshots/Edit.png" alt="Edit Track dialog with cover artwork, title, artist, album, genre, and release year" width="100%">

<br>

- Title, artist, album, album artist, genre, year
- Track and disc numbers
- Cover artwork
- Advanced fields such as composer, lyricist, conductor, label, ISRC, and BPM
- Lyrics and comments

A read-only file information view shows the technical details of a track.

<img src="docs/screenshots/File%20info.png" alt="File information dialog with technical details of a track" width="100%">

<br>
<br>

## Automatic Tagging

Identify a track from its audio or from a title and artist search, compare the matches, and write the one you choose back to the file. Auto-Tag is opened from the metadata editor with **Identify from audio**.

- Audio fingerprinting with AcoustID
- MusicBrainz search
- Candidate matches to compare
- Cover artwork options
- Review before saving

<br>
<br>

## Synced Lyrics

Time-synced lyrics follow the song. If they run early or late, adjust the timing offset.

<img src="docs/screenshots/Lyric%20sync.png" alt="Sync Lyrics dialog with timing offset controls" width="100%">

<br>
<br>

## Audio Conversion

Drop in files or a folder and convert them in one batch.

<img src="docs/screenshots/Convert.png" alt="Converter with a drag and drop area and a conversion queue" width="100%">

<br>

- Output formats: MP3, AAC, Opus, FLAC, ALAC, WAV
- Batch conversion
- Adjustable quality settings

<br>
<br>

## Themes and Customization

Choose from 12 backgrounds, including light ones, and 18 accent colors. Your choice is remembered between launches.

<img src="docs/screenshots/Themes.png" alt="Theme settings with background and accent color choices" width="100%">

<br>
<br>

## Listening History

Playnck keeps a history of what you have played.

<img src="docs/screenshots/history.png" alt="Listening history view" width="100%">

<br>
<br>

## Features

**Library**
Songs, albums, artists, genres, search, sorting, multi-select, favorites, listening history, folders kept in sync with the library.

**Playback**
Shuffle, repeat modes, queue, gapless playback, crossfade, 10-band equalizer with presets, visualizer, sleep timer, keyboard shortcuts, media keys.

**Metadata**
Metadata editing with write-back to the file, cover artwork, Auto-Tag, audio fingerprinting, MusicBrainz lookup, synced lyrics via [LRCLIB](https://lrclib.net).

**Organization**
Playlists, playlist folders, `.m3u8` export, multi-selection, library backup and restore.

**Conversion**
MP3, AAC, Opus, FLAC, ALAC, WAV, with batch conversion.

**Customization**
12 backgrounds, 18 accent colors, English and French interface.

<br>

## Why Playnck

- Your local files are the source of truth.
- No account, no subscription, no cloud library.
- Metadata changes are written to the real files.

<br>

## Supported Audio Formats

**Playback and library**

MP3, WAV, FLAC, OGG, M4A, AAC, Opus, and WebM audio.

**Conversion output**

MP3, AAC, Opus, FLAC, ALAC, WAV.

**Metadata write-back**

| Format | Written by |
| --- | --- |
| MP3 | Playnck directly |
| FLAC | Playnck directly |
| M4A, MP4, M4B | Playnck directly |
| Other formats (WAV, OGG, Opus, AAC, ...) | FFmpeg |

Conversion and FFmpeg-based tag writing need [FFmpeg](https://ffmpeg.org). Playnck checks for it and offers to install it from the Convert page.

<br>

## Supported Platforms

| Platform | Package |
| --- | --- |
| Windows 10 and 11 (64-bit) | `.exe` installer |
| Debian, Ubuntu, and derivatives (64-bit) | `.deb` |
| Fedora, openSUSE, and other RPM-based distributions (64-bit) | `.rpm` |

There is no macOS build and no Arch package at the moment.

<br>

## Download

Get the latest version from the **[Releases page](https://github.com/FakharArrazi/Project-Playnck/releases/latest)**.

## Installation

**Windows**

Run `Playnck-Setup-<version>.exe`. The installer lets you choose the install folder and can create desktop and Start menu shortcuts.

**Debian / Ubuntu**

```bash
sudo apt install ./<downloaded-file>.deb
```

**RPM-based distributions**

```bash
sudo dnf install ./<downloaded-file>.rpm
```

<br>

## Build From Source

Requires [Node.js](https://nodejs.org) 22 or newer (the release workflow uses 22) and npm.

```bash
git clone https://github.com/FakharArrazi/Project-Playnck.git
cd Project-Playnck
npm install
```

Run the app in development:

```bash
npm start
```

Build installers with electron-builder:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

On Windows, `npm run build -- --win` builds the NSIS installer. On Linux, `npm run build -- --linux` builds the `.deb` and `.rpm` (building the `.rpm` needs the `rpm` tools installed). Output goes to `dist/`.

<br>

## Development

Playnck is an Electron app with a plain HTML, CSS, and JavaScript interface.

| File | Role |
| --- | --- |
| `main.js` | Electron main process: windows, file scanning, updates |
| `preload.js` | Exposes a limited API from the main process to the interface |
| `index.html`, `script.js`, `script/`, `css/` | Interface (renderer) |
| `renderer-bridge.js` | Renderer-side integration with the system, including media keys |
| `metadata-bridge.js` | Reads and writes audio tags |
| `flac-tag-writer.js`, `m4a-tag-writer.js`, `id3-preserve.js` | Format-specific tag writers |
| `ffmpeg-bridge.js` | Finds FFmpeg and runs conversions and tag writes |
| `autotag-bridge.js` | Fingerprinting and online lookup for Auto-Tag |

The library is stored locally in the app, and your music files stay where they are.

## Project Structure

```text
Project-Playnck/
├── main.js                  Electron main process
├── preload.js               Preload bridge
├── index.html               Application markup
├── script.js                Renderer entry point
├── script/                  Interface modules (player, library, playlists, equalizer, ...)
├── css/, styles.css         Styles
├── *-bridge.js              Main-process bridges (metadata, FFmpeg, Auto-Tag, renderer)
├── tag-fields.js            Tag field definitions
├── build-scripts/           Packaging and release scripts
├── resources/               fpcalc binary and Linux icons
├── icons/                   Application and file icons
├── docs/screenshots/        Screenshots used in this README
├── test/                    Tests
├── LICENSE
└── THIRD-PARTY-NOTICES.txt
```

<br>

## Release Process

Releases are published through the **Release** GitHub Actions workflow (`.github/workflows/release.yml`).

1. Set the new version in `package.json`.
2. Run `npm run release`. It starts the workflow and waits for it, then checks that the published release has every download. `--dry-run` runs the checks without starting anything.
3. The workflow builds on two runners in parallel: a Windows runner builds the NSIS installer, and a Linux runner builds the `.rpm` and `.deb`.
4. A publish job collects the files and publishes the GitHub Release, including the update manifests used by `electron-updater`.

The workflow can also be started from the Actions tab, or by pushing a tag named `v<version>` that matches `package.json`. Pushes and pull requests to `main` run the builds without publishing.

<br>

## Technology

- Electron and electron-builder
- HTML, CSS, JavaScript
- IndexedDB
- music-metadata and node-id3
- FFmpeg
- Chromaprint (`fpcalc`), AcoustID, MusicBrainz, Cover Art Archive
- LRCLIB
- electron-updater

<br>

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `←` / `→` | Rewind / skip ahead 5 seconds |
| `Ctrl` + `←` / `→` (`⌘` on macOS keyboards) | Previous / next track |
| `↑` / `↓` | Volume up / down 5% |
| `M` | Mute / unmute |
| `R` | Add an extra replay of the current song |
| `Shift` + `R` | Clear the extra replays |
| Media keys | Play / Pause, previous, next |

<img src="docs/screenshots/Keyborad%20shortcut.png" alt="Keyboard shortcuts panel in Settings" width="100%">

<br>

## Support and Links

- [Source code](https://github.com/FakharArrazi/Project-Playnck)
- [Releases](https://github.com/FakharArrazi/Project-Playnck/releases)
- [Issues](https://github.com/FakharArrazi/Project-Playnck/issues)
- [Telegram](https://t.me/+taM7DL_CKsViNGM0)
- Donation details are in the app's About screen.

## Credits

Built and maintained by [Arrazi](https://github.com/Arrazi-w140).

Playnck uses third-party components that keep their own licenses, listed in [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt). Online data comes from AcoustID, MusicBrainz, the Cover Art Archive, and LRCLIB.

## License

Playnck is released under the Playnck License. You may use, modify, fork, and share it, including for commercial use of your own work, but you may not sell Playnck or modified versions of it. See [`LICENSE`](LICENSE) for the full terms.

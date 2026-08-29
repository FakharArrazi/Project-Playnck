<div align="center">

# 🎵 Playnck

**A native-feeling, self-healing music player for people who actually care about their local library.**

Built with Electron. Writes real ID3/metadata back to your files. Fingerprints and auto-tags your unsorted MP3s. Ten-band EQ. Synced lyrics. Seventy-two theme combinations. Zero cloud, zero accounts, zero nonsense.

[![Latest Release](https://img.shields.io/github/v/release/FakharArrazi/Project-Playnck?label=latest%20release&color=6C5CE7)](https://github.com/FakharArrazi/Project-Playnck/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/FakharArrazi/Project-Playnck/total?color=00b894)](https://github.com/FakharArrazi/Project-Playnck/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)
![Platform](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)
![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron)
[![License: Proprietary](https://img.shields.io/badge/license-proprietary-lightgrey)](#-license)

![Playnck home dashboard](docs/screenshots/Home.png)

</div>

---

## ✨ Features

### 🎧 Playback & library
- Plays MP3, WAV, FLAC, OGG, M4A/AAC, and Opus straight from disk — no import/transcode step, no library database bloat.
- Audio is streamed through a custom `playnck-file://` Electron protocol with proper HTTP `Range` / `206 Partial Content` support, so seeking is instant even on long tracks.
- **Self-healing library**: on launch and on demand, Playnck checks every track path against the disk and quietly prunes anything that's been moved, renamed outside the app, or deleted — no dead entries, no manual "clean up library" step.
- **Watched folders** are re-scanned automatically to pick up newly added files and drop ones that disappeared.
- Drag-and-drop files or whole folders straight into the window to add them.
- Deleting a track from Playnck sends the real file to your **system trash** (Recycle Bin on Windows, the desktop trash via `gio trash` on Linux) — never a hard delete.
- Shuffle with real history (going "previous" during shuffle retraces what you actually played, not a random jump), plus off/one/all repeat modes.
- Gapless-style crossfade between tracks (~3 seconds) so the player never leaves a dead silence gap on the last few seconds of a song.

<p align="center"><img src="docs/screenshots/Library.png" alt="Songs library view" width="850"></p>

### 🏠 Home dashboard
- Library stats at a glance, a **Recently Played** rail, and a **Top Songs** list ranked by real play count.
- Play counts only increment after a track has actually played for **30 seconds** — skips and accidental clicks don't inflate your stats.

### 🗂️ Organize your way
- Dedicated tabs for **Songs, Albums, Artists, Playlists, and Folders**, each with its own sort order.
- Multi-select across every tab (songs, albums, artists, playlists, folders) for bulk actions.
- Create playlists and **export them as standard `.m3u`** files that other players can read.
- Fast, debounced live search that filters whichever tab you're on.

<table align="center">
<tr>
<td><img src="docs/screenshots/Albums.png" alt="Albums tab" width="420"></td>
<td><img src="docs/screenshots/Artists.png" alt="Artists tab" width="420"></td>
</tr>
<tr>
<td><img src="docs/screenshots/Playlists.png" alt="Playlists tab" width="420"></td>
<td><img src="docs/screenshots/Folders.png" alt="Folders tab" width="420"></td>
</tr>
</table>

### 🎚️ A real audio engine, not just an `<audio>` tag
- **10-band graphic equalizer** (32 Hz → 16 kHz) built on the Web Audio API with live `BiquadFilterNode` chaining, ±12 dB per band.
- One-click presets: **Flat, Bass Boost, Treble Boost, Vocal Boost** — or drag your own curve.
- **Gapless playback**: a short automatic crossfade smooths the transition between songs instead of a hard cut (skipped on repeat-one).
- A live, reactive **frequency visualizer** rendered on canvas that pulls its color directly from your active theme's accent, with an adjustable intensity/opacity slider.

<p align="center"><img src="docs/screenshots/Audio.png" alt="10-band equalizer and gapless playback settings" width="850"></p>

### 🏷️ Metadata that actually writes back to the file
This is the feature that gets the most engineering attention in the codebase, and it shows:
- Edit title, artist, album, genre, track number, and cover art, and Playnck writes it into the **real file on disk** — ID3 tags via `node-id3` for MP3, FFmpeg-backed tagging for everything else — then re-reads the file to verify the write actually landed.
- Windows loves to lock files that are mid-playback, so before any rename/write, Playnck **detaches the audio element from the file, performs the write, and re-attaches it**, seeking back to the exact playback position.
- If a write still hits `EPERM`/`EBUSY`/`EACCES` because something else has the handle open, it **retries with backoff** instead of silently failing or corrupting the tag.
- Cover art can be added, replaced, or pulled automatically (see Auto-Tag below).

### 🔎 Auto-Tag (audio fingerprinting)
For that folder of `Track 03.mp3` files with no metadata at all:
- Generates an **audio fingerprint** of the file using a bundled Chromaprint (`fpcalc`) binary.
- Looks the fingerprint up against **AcoustID**, falls back to a text-based **MusicBrainz** search if there's no fingerprint match, and pulls cover art from the **Cover Art Archive**.
- Shows you the match before writing anything, so you're never surprised by an auto-tag result.

### 🎤 Synced lyrics
- Fetches time-synced (LRC-format) lyrics from lrclib.net and highlights the current line in real time as the track plays, over a blurred version of the album art.
- Lyrics are cached locally so repeat plays don't re-fetch, and you can nudge the sync offset if a particular file's timing is slightly off.

### 🎨 Deep personalization
- **6 background themes × 12 accent colors** — 72 total combinations — all switchable live from the swatch grid.
- On Windows, the custom title bar overlay recolors itself to match your theme automatically (Linux uses your desktop environment's native window decorations instead).
- English and French UI translations out of the box.

<p align="center"><img src="docs/screenshots/Themes.png" alt="Theme picker with background and accent swatches" width="850"></p>

### 🔁 Format conversion studio
- A dedicated **Convert** tab batches files or whole folders through a bundled FFmpeg install.
- Converts to **MP3, AAC, Opus, FLAC, ALAC, or WAV**, correctly marking which targets are lossless and which support embedded cover art.
- On Windows, FFmpeg installs itself on first use via `winget` — no separate download-and-PATH dance. On Linux, Playnck detects an existing `ffmpeg` on your `$PATH` and uses it directly; if it's missing, the Convert tab tells you the exact command for your distro (e.g. Fedora needs RPM Fusion for the full codec set — `ffmpeg-free` alone can't encode MP3).

<p align="center"><img src="docs/screenshots/Convert.png" alt="Convert tab with FFmpeg ready" width="850"></p>

### ⚙️ Settings, all in one place
Everything above is configurable from a single Settings panel, organized into **Theme, Updates, Audio, Player, Backup & Restore, and Language** — no digging through nested menus to find a toggle.

<p align="center"><img src="docs/screenshots/Setting.png" alt="Settings panel with Theme, Updates, Audio, Player, Backup & Restore, and Language sections" width="850"></p>

### 🛡️ Reliability & housekeeping
- Optional **sleep timer** (15/30/45/60/90 minutes) that fades out and stops playback.
- **Backup & Restore** built into Settings, so your library/tags/preferences aren't stranded on one machine.
- Ships an EULA and third-party notices, with a locally vendored copy of `jsmediatags` and a strict Content-Security-Policy — the app doesn't reach out to arbitrary remote scripts.
- **Auto-updates** via `electron-updater` on Windows, checking Playnck's own GitHub Releases. The Linux RPM build updates like any other system package instead — see [Installation](#-installation) below.

---

## 🧰 Tech stack

| Layer | What's used |
|---|---|
| Shell | Electron 43 |
| UI | Vanilla HTML/CSS/JS (no framework — hand-rolled rendering) |
| Metadata read | `music-metadata` |
| Metadata write | `node-id3` (MP3) + FFmpeg (everything else) |
| Fingerprinting | Chromaprint (`fpcalc`) → AcoustID → MusicBrainz → Cover Art Archive |
| Lyrics | lrclib.net |
| Auto-update | `electron-updater` + GitHub Releases |
| Packaging | `electron-builder` (NSIS installer for Windows, RPM for Linux) + `javascript-obfuscator` |

---

## 📦 Installation

Grab the latest build for your platform from the [**Releases**](https://github.com/FakharArrazi/Project-Playnck/releases/latest) page.

### Windows

Run `Playnck Setup <version>.exe`. The installer lets you choose the install directory and creates Desktop + Start Menu shortcuts. Playnck checks for new versions on launch and offers to install them in-app.

### Linux (Fedora / RPM-based distros)

Download `playnck-<version>.x86_64.rpm` and install it with your package manager, e.g. on Fedora:

```bash
sudo dnf install ./playnck-<version>.x86_64.rpm
```

This installs Playnck under `/opt/Playnck`, adds it to your application launcher (Fedora's `Files`/`Software`/GNOME/KDE app grids all pick it up automatically), and registers it as an opener for `.mp3`/`.wav`/`.flac`/`.ogg`/`.m4a` files.

The primary target is **x86_64 Fedora and RHEL-compatible distributions** (anything that can install a standard RPM with `gtk3`, `libnotify`, `nss`, and the other libraries any modern Electron app needs — all pulled in automatically as package dependencies). It should also work on openSUSE and other RPM-based distros with the same libraries available.

Unlike the Windows build, Playnck on Linux does **not** auto-update in-app — an RPM installed system-wide under `/opt` isn't something the app can safely overwrite itself the way the Windows installer's self-replace can. Update it the same way you installed it: download the newest RPM from Releases and run `sudo dnf install ./playnck-<version>.x86_64.rpm` again (or `dnf upgrade` if you've added a repo that serves it). The in-app Settings → Updates button explains this and links back to the Releases page if you click "Check for Updates" on Linux.

FFmpeg (used by the Convert tab) isn't bundled — Playnck looks for `ffmpeg` on your `$PATH` and tells you exactly what to install if it's missing. On Fedora, the official repo's `ffmpeg-free` package can't encode MP3 (patent-encumbered `libmp3lame` is left out); enable [RPM Fusion](https://rpmfusion.org/) first for the full build:

```bash
sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
sudo dnf install ffmpeg
```

Auto-Tag's audio fingerprinting works out of the box — a Linux `fpcalc` binary ships inside the RPM, no separate Chromaprint install needed.

## 🏗️ Building from source

```bash
git clone https://github.com/FakharArrazi/Project-Playnck.git
cd Project-Playnck
npm install

# Run in development
npm start

# Build a distributable for your current OS
# (Windows -> .exe installer, Linux -> .rpm package)
npm run build

# Build and publish a GitHub release for your current OS
# (requires publish credentials — see below)
npm run release
```

`npm run build`/`npm run release` always build for whichever OS you're running them on — there's no reliable way to cross-build a real Fedora RPM from Windows or a trustworthy NSIS installer from Linux, so electron-builder doesn't try. Building the Linux RPM requires the `rpmbuild` tool (`sudo dnf install rpm-build` on Fedora, `sudo apt-get install rpm` on Debian/Ubuntu).

**Official releases with both platforms** are built by [`.github/workflows/release.yml`](.github/workflows/release.yml): a Windows runner builds the `.exe`, a Linux runner builds the `.rpm`, and a final job combines both into one GitHub Release automatically. To cut a release, either push a `v<version>` tag matching `package.json`'s version, or run the "Release" workflow manually from this repo's Actions tab — no manual building, uploading, or release-creation needed. `npm run release` from a single machine still works exactly as before for a single-platform release.

Both `Setup.exe` and `.x86_64.rpm` always share the exact same version number, read from `package.json` — there's only one version to bump.

## ⚙️ Requirements

**Windows**
- Windows 10/11
- FFmpeg is **not** a manual prerequisite — the app installs it on demand via `winget` when you first use the Convert tab

**Linux**
- A 64-bit (x86_64) Fedora or RHEL-compatible distribution is the primary target (built and tested against; other RPM-based distros with `gtk3`/`libnotify`/`nss` available should work too)
- FFmpeg is a manual install if you want to use the Convert tab (see [Installation](#-installation) above) — Auto-Tag fingerprinting doesn't need it, that binary ships inside the RPM

**Building from source (either platform)**
- [Node.js](https://nodejs.org/) (current LTS) + npm
- Building the Linux RPM specifically also needs `rpmbuild` on your `$PATH`

---

## 📁 Project structure

```
Project-Playnck/
├── main.js                  # Electron main process — windows, IPC, protocols, updater
├── preload.js                # Context bridge between main and renderer
├── script.js                 # Renderer: UI, playback engine, EQ, visualizer, state
├── metadata-bridge.js          # Reads/writes ID3 & file metadata, EPERM retry logic
├── autotag-bridge.js           # Chromaprint fingerprinting → AcoustID/MusicBrainz
├── ffmpeg-bridge.js             # Format conversion pipeline
├── index.html / styles.css      # App shell and styling
├── build-scripts/               # Obfuscation + electron-builder release pipeline
│   ├── build.js                  #   npm run build / npm run release entry point
│   ├── publish-release.js        #   combines the CI-built .exe + .rpm into one release
│   └── reconcile-github-release.js  # cleans up a split release if one ever occurs
├── resources/fpcalc/             # Bundled Chromaprint binaries (win32 + linux)
├── resources/icons/linux/        # Linux hicolor icon set, generated from icons/icon.ico
├── .github/workflows/release.yml # Windows + Linux CI build and combined release
├── docs/screenshots/              # README screenshots
├── LICENSE                       # End-user license agreement
└── THIRD-PARTY-NOTICES.txt       # Third-party attributions
```

---

## 💬 Community

Playnck ships with an in-app **About** screen — current build version, a short description of the app, and a one-click link to join the project's Telegram group for update announcements, feature requests, and support.

<p align="center"><img src="docs/screenshots/About.png" alt="About Us screen with build version and Telegram community link" width="850"></p>

## ❤️ Support Playnck

Enjoying Playnck? If you'd like to support the project and its future
development, you can donate through Binance Pay.

### Binance Pay

<p align="center">
  <a href="https://app.binance.com/uni-qr/5tLuirTT">
    <img src="docs/screenshots/Donation.jpg" alt="Binance Pay donation QR code" width="220">
  </a>
</p>

<p align="center"><strong><a href="https://app.binance.com/uni-qr/5tLuirTT">Donate with Binance Pay</a></strong></p>

Scan the QR code or click the link above to make a donation.

## 🧑‍💻 Credits

Built and maintained by **[Arrazi](https://github.com/Arrazi-w140)**.

## 📄 License

Playnck is **source-available, not open source**. It's distributed under a custom End-User License Agreement (see [`LICENSE`](LICENSE)) — you're licensed to install and use the compiled app for personal/internal use, but redistribution, modification, and reverse engineering are restricted. See the LICENSE file for the full terms.

---

<div align="center">

If Playnck's your daily driver, a ⭐ on the repo goes a long way.

</div>

# fpcalc binaries

Auto-tag's audio-fingerprinting tier (see `autotag-bridge.js`) shells
out to `fpcalc`, the command-line tool from the Chromaprint project,
to generate an AcoustID fingerprint for a track.

This folder is empty in source control on purpose — the binaries are
platform-specific and not something to commit. Before building a
release, download the prebuilt Chromaprint binaries for each OS you
ship from https://acoustid.org/chromaprint and lay them out as:

```
resources/fpcalc/
  win32/fpcalc.exe
  darwin/fpcalc
  linux/fpcalc
```

`package.json`'s `build.extraResources` copies this whole folder into
the packaged app as `resources/fpcalc/...`, and `resolveFpcalcPath()`
in `autotag-bridge.js` looks there first (falling back to a system
PATH `fpcalc`, which is enough for local `npm start` development if
you `apt install`/`brew install chromaprint` instead).

If no `fpcalc` binary can be found at all, fingerprinting is skipped
silently — Auto-tag still works, just falls back to a plain
title/artist text search against MusicBrainz instead of identifying
the song from the audio itself.

You'll also need a free AcoustID client API key from
https://acoustid.org/api-key, pasted into `ACOUSTID_CLIENT_KEY` near
the top of `autotag-bridge.js` — without one, the fingerprint tier is
skipped the same way as when the binary is missing.

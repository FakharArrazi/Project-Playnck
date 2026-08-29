# fpcalc binaries

Auto-tag's audio-fingerprinting tier (see `autotag-bridge.js`) shells
out to `fpcalc`, the command-line tool from the Chromaprint project,
to generate an AcoustID fingerprint for a track.

Both platform binaries Playnck ships for are committed here as
unmodified downloads from Chromaprint's official GitHub releases
(https://github.com/acoustid/chromaprint/releases), so `npm run build`
works out of the box on a fresh checkout without a separate manual
download step before packaging:

```
resources/fpcalc/
  win32/fpcalc.exe   (Windows)
  linux/fpcalc       (Linux — must keep its executable bit; git tracks
                       this, so a normal clone/checkout preserves it)
```

There's no `darwin/` binary since Playnck doesn't currently ship a
macOS build; add one the same way (a real fpcalc downloaded from the
link above, `chmod +x`'d, `git add`'d) if that ever changes —
`resolveFpcalcPath()` in `autotag-bridge.js` already branches on
`process.platform` generically rather than hardcoding just win32/linux.

See THIRD-PARTY-NOTICES.txt for the exact license these binaries carry
(Chromaprint's own code is MIT, but the official fpcalc build
statically links a small LGPL-licensed FFmpeg, which is why the
binary as a whole is treated as LGPL 2.1 here).

`package.json`'s `build.extraResources` copies this whole folder into
the packaged app as `resources/fpcalc/...`, and `resolveFpcalcPath()`
in `autotag-bridge.js` looks there first (falling back to a system
PATH `fpcalc`, which is enough for local `npm start` development if
you `apt install`/`dnf install`/`brew install chromaprint` instead).

If no `fpcalc` binary can be found at all, fingerprinting is skipped
silently — Auto-tag still works, just falls back to a plain
title/artist text search against MusicBrainz instead of identifying
the song from the audio itself.

You'll also need a free AcoustID client API key from
https://acoustid.org/api-key, pasted into `ACOUSTID_CLIENT_KEY` near
the top of `autotag-bridge.js` — without one, the fingerprint tier is
skipped the same way as when the binary is missing.


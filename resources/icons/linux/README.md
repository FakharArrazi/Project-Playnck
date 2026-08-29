# Linux icon set

electron-builder's `rpm`/`deb` targets need the app icon as a set of
plain PNGs named by size (`16x16.png`, `32x32.png`, ...) rather than
the single `.ico` Windows uses — each size gets installed into the
matching `/usr/share/icons/hicolor/<size>x<size>/apps/` folder so
Fedora's launcher, taskbar, and alt-tab switcher all pick the sharpest
one available instead of scaling a single image up or down.

Every file here is generated from the same source art already used
for Windows (`icons/icon.ico`, a 256x256 PNG embedded in an ICO
container — the highest resolution that file has). 256 is also this
set's largest size: there's no higher-resolution source to generate a
512 or 1024 from without inventing detail that isn't there, and
letting the desktop environment downscale the existing 256 on the rare
HiDPI context that wants something bigger looks better than an
artificially upscaled file would.

Regenerate after a real icon redesign with:

```bash
convert icons/icon.ico[0] resources/icons/linux/256x256.png
for size in 16 24 32 48 64 128; do
  convert resources/icons/linux/256x256.png -filter Lanczos \
    -resize ${size}x${size} resources/icons/linux/${size}x${size}.png
done
```

`package.json`'s `build.linux.icon` points at this folder directly.

#!/usr/bin/env bash
# Packs build/icon.png into build/icon.icns, the format macOS and
# electron-builder want. Every size is resampled from the 2048² master rather
# than from each other, so the 16pt version stays crisp instead of compounding
# blur. Uses only sips and iconutil, both part of macOS.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="build/icon.png"
SET="build/icon.iconset"

[ -f "$SRC" ] || { echo "error: $SRC missing — run \`npx electron scripts/make-icon.cjs\` first" >&2; exit 1; }

rm -rf "$SET"
mkdir -p "$SET"

# name                  pixels
for entry in \
  "icon_16x16.png 16" \
  "icon_16x16@2x.png 32" \
  "icon_32x32.png 32" \
  "icon_32x32@2x.png 64" \
  "icon_128x128.png 128" \
  "icon_128x128@2x.png 256" \
  "icon_256x256.png 256" \
  "icon_256x256@2x.png 512" \
  "icon_512x512.png 512" \
  "icon_512x512@2x.png 1024"
do
  set -- $entry
  sips -z "$2" "$2" "$SRC" --out "$SET/$1" > /dev/null
done

iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$SET"

echo "==> build/icon.icns  ($(du -h build/icon.icns | cut -f1))"

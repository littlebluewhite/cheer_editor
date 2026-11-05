#!/bin/sh
# 從 static/favicon.svg 產生 favicon.ico、apple-touch-icon 和 PWA manifest 用的 PNG。
# 要先裝 ImageMagick（macOS：brew install imagemagick）。產生的檔要 commit。
set -eu
cd "$(dirname "$0")/../static"

png() { magick -background none -density 384 favicon.svg -resize "$1x$1" -depth 8 "$2"; }

png 180 apple-touch-icon.png
png 192 pwa-192x192.png
png 512 pwa-512x512.png
magick -background none -density 384 favicon.svg -define icon:auto-resize=48,32,16 favicon.ico

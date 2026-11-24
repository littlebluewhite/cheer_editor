#!/bin/sh
# 從 static/favicon.svg 產生 favicon.ico、apple-touch-icon、PWA manifest 用的 PNG 和 App 的圖示。
# 要先裝 ImageMagick（macOS：brew install imagemagick）。產生的檔要 commit。
set -eu
cd "$(dirname "$0")/../static"

png() { magick -background none -density 384 favicon.svg -resize "$1x$1" -depth 8 "$2"; }

png 180 apple-touch-icon.png
png 192 pwa-192x192.png
png 512 pwa-512x512.png
magick -background none -density 384 favicon.svg -define icon:auto-resize=48,32,16 favicon.ico
# App 的圖示：一張 1024，不能有透明（App Store 不收），圓角 iOS 自己切
magick -density 384 favicon.svg -resize 1024x1024 -background '#2f66b8' -alpha remove -alpha off -depth 8 \
	../ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png

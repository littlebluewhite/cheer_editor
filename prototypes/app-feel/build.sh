#!/usr/bin/env bash
# 小樣（#300），比完就丟。建、裝到真機、打開。
#   ./build.sh native|web [iphone|ipad|both]   （預設 both）
# 簽章用的團隊、bundle id、裝置寫在 .local.env（不進 git）。
set -euo pipefail
cd "$(dirname "$0")"
source .local.env
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

app=${1:?用法：./build.sh native|web [iphone|ipad|both]}
where=${2:-both}
case $app in
  native) name=CheerFeelNative ;;
  web) name=CheerFeelWeb ;;
  *) echo "native 或 web"; exit 1 ;;
esac
root=$(git rev-parse --show-toplevel)

if [ "$app" = native ]; then
  node "$root/scripts/core-bundle.mjs" out/core
  cp out/core/flow-core.js native/CheerFeelNative/flow-core.js
else
  # 包在 app 裡的網頁：建前端，整包放進 Site.bundle（資料夾結構照留）
  (cd "$root" && npm run build >/dev/null)
  rm -rf web/CheerFeelWeb/Site.bundle && cp -R "$root/build" web/CheerFeelWeb/Site.bundle
fi

if [ "$where" = sim ]; then
  # 模擬器（只給我先看會不會動，手感不算）
  xcodebuild -project "$app/$name.xcodeproj" -scheme "$name" -configuration Release \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath out/dd-sim CODE_SIGNING_ALLOWED=NO \
    LOCAL_TEAM_ID="$LOCAL_TEAM_ID" LOCAL_BUNDLE_PREFIX="$LOCAL_BUNDLE_PREFIX" -quiet build
  xcrun simctl install booted "out/dd-sim/Build/Products/Release-iphonesimulator/$name.app"
  xcrun simctl launch --terminate-running-process booted "$LOCAL_BUNDLE_PREFIX.$name"
  exit
fi

xcodebuild -project "$app/$name.xcodeproj" -scheme "$name" -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath out/dd -allowProvisioningUpdates \
  LOCAL_TEAM_ID="$LOCAL_TEAM_ID" LOCAL_BUNDLE_PREFIX="$LOCAL_BUNDLE_PREFIX" -quiet build
appPath="out/dd/Build/Products/Release-iphoneos/$name.app"

devices=()
[ "$where" != ipad ] && devices+=("$IPHONE_UDID")
[ "$where" != iphone ] && devices+=("$IPAD_UDID")
for d in "${devices[@]}"; do
  # 第一次連常常斷掉，再試一次
  xcrun devicectl device install app --device "$d" "$appPath" >/dev/null 2>&1 ||
    xcrun devicectl device install app --device "$d" "$appPath" >/dev/null
  echo "裝好：$d"
  xcrun devicectl device process launch --terminate-existing --device "$d" "$LOCAL_BUNDLE_PREFIX.$name" >/dev/null && echo "打開了：$d" || echo "沒打開（裝置鎖著？）：$d"
done

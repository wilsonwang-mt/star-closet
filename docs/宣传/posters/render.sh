#!/bin/zsh
# 导出海报 PNG：./render.sh 1  → out/nova-01-portrait.png（2160×2880）与 out/nova-01-wide.png（3840×2160）
set -e
cd "$(dirname "$0")"
n=${1:-1}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p out
for f in portrait wide; do
  [[ $f == portrait ]] && size=1080,1440 || size=1920,1080
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-proxy-server \
    --allow-file-access-from-files --force-device-scale-factor=2 \
    --window-size=$size --virtual-time-budget=4000 \
    --screenshot="$PWD/out/nova-0$n-$f.png" "file://$PWD/poster.html?n=$n&f=$f" 2>/dev/null
done
ls -la out

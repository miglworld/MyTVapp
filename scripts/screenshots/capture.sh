#!/bin/sh
# Retakes the README screenshots (docs/images/*.jpg). macOS only: it uses the
# system web view through a small Swift tool.
#
# The pictures come from a demo setup, not from real channels: invented
# channels and programmes, a drawn picture in place of video, and a stand-in
# for the Samsung player (scripts/screenshots/make-demo.py).
set -e
cd "$(dirname "$0")/../.."
TOOL="${TMPDIR:-/tmp}/mytvapp-shot"
OUT="${TMPDIR:-/tmp}/mytvapp-shots"
mkdir -p "$OUT" docs/images

swiftc -O scripts/screenshots/shot.swift -o "$TOOL"
python3 scripts/screenshots/make-demo.py
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf _shots _shot.html' EXIT
sleep 1

for scene in live menu guide full full-list settings settings-playback notice; do
	"$TOOL" "http://localhost:8765/_shot.html?scene=$scene" "$OUT/$scene.png" 8
	sips -s format jpeg -s formatOptions 84 -Z 1600 "$OUT/$scene.png" --out "docs/images/$scene.jpg" >/dev/null
done
echo "Screenshots written to docs/images/"

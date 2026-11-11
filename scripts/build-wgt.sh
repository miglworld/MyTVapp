#!/bin/sh
# Builds the UNSIGNED MyTvApp.wgt from the files the TV needs.
# Fails if the version is not the same in package.json, config.xml, js/main.js and js/boot.js.
# Sign the result with your own Samsung certificate before installing it.
set -e
cd "$(dirname "$0")/.."

pkg=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
cfg=$(sed -n 's/.*id="[^"]*" version="\([^"]*\)".*/\1/p' config.xml | head -1)
app=$(sed -n "s/.*var APP_VERSION = '\([^']*\)'.*/\1/p" js/main.js | head -1)
boot=$(sed -n "s/.*var BUNDLED_VERSION = '\([^']*\)'.*/\1/p" js/boot.js | head -1)

if [ -z "$pkg" ] || [ "$pkg" != "$cfg" ] || [ "$pkg" != "$app" ] || [ "$pkg" != "$boot" ]; then
	echo "Version mismatch: package.json=$pkg config.xml=$cfg js/main.js=$app js/boot.js=$boot" >&2
	exit 1
fi

rm -f MyTvApp.wgt
zip -q -X MyTvApp.wgt config.xml index.html icon.png \
	css/style.css js/boot.js js/main.js lib/hls.min.js lib/hls.LICENSE
echo "Built MyTvApp.wgt (version $pkg, unsigned)"

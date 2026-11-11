#!/bin/sh
# Checks to pass before anything is merged into main, because TVs update
# themselves from main. Run locally with: ./scripts/check.sh
# In a pull request, set BASE_REF (e.g. origin/main) to also require a higher
# version number whenever the app's own files changed.
set -e
cd "$(dirname "$0")/.."
fail() { echo "CHECK FAILED: $1" >&2; exit 1; }

# 1. Every script parses.
for f in js/main.js js/boot.js scripts/test.js; do
	node --check "$f" || fail "$f does not parse"
done

# 2. The version is the same in all four places.
pkg=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
cfg=$(sed -n 's/.*id="[^"]*" version="\([^"]*\)".*/\1/p' config.xml | head -1)
app=$(sed -n "s/.*var APP_VERSION = '\([^']*\)'.*/\1/p" js/main.js | head -1)
boot=$(sed -n "s/.*var BUNDLED_VERSION = '\([^']*\)'.*/\1/p" js/boot.js | head -1)
[ -n "$pkg" ] || fail "no version in package.json"
[ "$pkg" = "$cfg" ] && [ "$pkg" = "$app" ] && [ "$pkg" = "$boot" ] ||
	fail "version mismatch: package.json=$pkg config.xml=$cfg js/main.js=$app js/boot.js=$boot"
echo "$pkg" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "version $pkg is not in the form 1.2.3"

# 3. What self-update and the package rely on.
grep -q '<content src="index.html" />' config.xml || fail "config.xml must start index.html"
grep -q 'id="app"' index.html || fail "index.html has no #app element"
grep -q '<script src="js/boot.js"></script>' index.html || fail "index.html must load js/boot.js"
grep -q 'window.MYTVAPP_STARTED = true' js/main.js || fail "js/main.js must set MYTVAPP_STARTED"
if grep -q 'url(' css/style.css; then fail "css/style.css must not use url(): a downloaded update has no files next to it"; fi

# 4. Tests.
node scripts/test.js || fail "tests"

# 5. In a pull request: app files changed => the version must be higher than on the base branch.
if [ -n "$BASE_REF" ]; then
	changed=$(git diff --name-only "$BASE_REF"...HEAD -- index.html css js || true)
	if [ -n "$changed" ]; then
		base=$(git show "$BASE_REF":package.json | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)
		node -e '
			var a = process.argv[1].split("."), b = process.argv[2].split(".");
			for (var i = 0; i < 3; i++) { var p = +a[i] || 0, q = +b[i] || 0; if (p !== q) process.exit(p > q ? 0 : 1); }
			process.exit(1);
		' "$pkg" "$base" || fail "app files changed but the version ($pkg) is not higher than $BASE_REF ($base): TVs would not pick the change up"
	fi
fi

echo "All checks passed (version $pkg)"

# TVapp

> Fork of [KaashDev/TVapp](https://github.com/KaashDev/TVapp), the original app by KaashDev. See [Changes in this fork](#changes-in-this-fork).

A Samsung Smart TV app built with Tizen Studio that streams live IPTV channels from M3U/M3U8 playlists, navigable entirely with a TV remote.

## Demo

[![Watch the demo](images/thumbnail.png)](https://www.youtube.com/watch?v=Uj-7Cc0Xxqk)

## Features

- **Multiple playlists, multiple active at once** — add any number of M3U/M3U8 playlist URLs in Settings, and toggle each one active/inactive independently with a checkbox. Categories from different active playlists are kept visually separate (grouped under a header per playlist) rather than merged together.
- **One-press iptv-org presets** — Settings offers **+ Add IPTV-ORG Portugal** (`countries/pt.m3u`) and **+ Add IPTV-ORG All Countries** (`index.country.m3u`), fetched live from `iptv-org.github.io`. No playlist is bundled in the package.
- **Categories & channel browsing** — channels are grouped by `group-title` into an alphabetical, two-column category list, then into a channel grid per category.
- **Favorites** — star any channel while watching it. Favorites persist independently of which playlists are active, but are only *shown* while their source playlist is active (deactivating a playlist hides its favorites without deleting them; deleting the playlist removes them for good).
- **Remote-control navigation** — a custom focus-zone system drives all navigation via D-pad (arrow keys + Enter/OK) and the remote's Back key; no mouse/pointer required. Includes Channel Up/Down zapping and Play/Pause from the remote.
- **Playback with automatic fallback** — on a Samsung TV the TV's built-in player is tried first (native HLS, not subject to CORS), then [hls.js](https://github.com/video-dev/hls.js/) (bundled locally, v1.6.19). If a player errors or shows no video within 12 s, the next one is tried. A status line in the player shows which player is in use and the exact error if a channel fails.
- **Native text input** — the playlist URL field is a real input that opens Samsung's system keyboard, so you can also type from your phone with the SmartThings app.

## Requirements

- [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk.html) (or just the Tizen CLI tools under `tools/ide/bin` and `tools/`) with the `tv-samsung` platform installed.
- A Samsung TV or the Tizen TV emulator/simulator running Tizen 2.3+.
- A signing security profile registered with the Tizen CLI (`tizen security-profiles list` / `tizen security-profiles add`) to package and install the app.

## Project structure

```
config.xml           Tizen widget manifest (app id, privileges, profile)
index.html            App shell — all screens as <section> elements
css/style.css         All styling (focus states, layout, screens)
js/main.js            App logic: Focus/navigation, playlists, playback, favorites
lib/hls.min.js        hls.js 1.6.19, bundled (license: lib/hls.LICENSE)
images/thumbnail.png  README demo thumbnail
noun-live-tv-3548799.png   Widget icon referenced by config.xml
TVapp.wgt             Pre-built UNSIGNED package (sign with your own Samsung certificate)
```

## Building

From the project root:

```bash
# 1. Compile the web content into .buildResult/
tizen build-web -- .

# 2. Package .buildResult/ into a signed .wgt
tizen package -t wgt -s <your-security-profile> -- .buildResult
```

This produces `.buildResult/TVapp.wgt`.

## Installing on a device or emulator

```bash
# Connect to the TV/emulator (skip if already connected)
sdb connect <tv-ip-address>

# Install
tizen install -n TVapp.wgt -t <device-id> -- .buildResult
```

Alternatively, install the pre-built `TVapp.wgt` from this repo. It is **unsigned**: sign it with your own Samsung certificate (the TizenBrew Installer does this on Tizen 7+, or use `tizen package -t wgt -s <profile>`). If an older copy signed by someone else is installed, uninstall it first or the install fails with "Author certificate not match".

## Notes on network dependence

Playlists are fetched from their URL at startup; loads that hang are aborted after 15 seconds with an error toast rather than blocking the UI. Individual channels stream from their own servers, and many free iptv-org streams are offline or geo-blocked at any given time.

## Changes in this fork

- Replaced the custom D-pad keyboard with a native input (Samsung IME + SmartThings phone keyboard).
- TV built-in player first, hls.js fallback, 12 s no-video watchdog, on-screen status line.
- hls.js bundled locally and pinned (was loaded from a CDN as `hls.js@1` at runtime).
- Fatal stream errors end with a message instead of retrying forever or hanging silently.
- Channel grids render in batches of 60 (big categories had 1,000-2,000 tiles at once); category list built in one DOM pass.
- Removed the bundled 14k-channel playlist (old stored entry is migrated away; its favorites stay playable) and added iptv-org presets.
- Removed the Donate screen and unused images; cleaned duplicate privileges in `config.xml`; fixed two broken `@keyframes` rules (loading spinner).

## Credits

Original app: [KaashDev/TVapp](https://github.com/KaashDev/TVapp). The upstream repository has no license file, so this fork is shared for personal use and to offer changes back upstream.

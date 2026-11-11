# MyTvApp

> Fork of [KaashDev/TVapp](https://github.com/KaashDev/TVapp), the original app by KaashDev. See [Changes in this fork](#changes-in-this-fork).

MyTvApp (formerly TVapp) is a Samsung Smart TV app built with Tizen Studio that streams live IPTV channels from M3U/M3U8 playlists, navigable entirely with a TV remote.

## Demo

[![Watch the demo](images/thumbnail.png)](https://www.youtube.com/watch?v=Uj-7Cc0Xxqk)

## Features

- **Multiple playlists, multiple active at once** — add any number of M3U/M3U8 playlist URLs in Settings, and toggle each one active/inactive independently with a checkbox. Categories from different active playlists are kept visually separate (grouped under a header per playlist) rather than merged together.
- **One-press iptv-org presets** — Settings offers **+ Add IPTV-ORG Portugal** (`countries/pt.m3u`) and **+ Add IPTV-ORG All Countries** (`index.country.m3u`), fetched live from `iptv-org.github.io`. No playlist is bundled in the package.
- **Categories & channel browsing** — channels are grouped by `group-title` into an alphabetical, two-column category list, then into a channel grid per category.
- **Favorites** — star any channel while watching it. Favorites persist independently of which playlists are active, but are only *shown* while their source playlist is active (deactivating a playlist hides its favorites without deleting them; deleting the playlist removes them for good).
- **Remote-control navigation** — a custom focus-zone system drives all navigation via D-pad (arrow keys + Enter/OK) and the remote's Back key; no mouse/pointer required. Includes Channel Up/Down zapping and Play/Pause from the remote.
- **Playback with automatic fallback** — in the installed app, Samsung's native player (**AVPlay**) is used first: it opens stream URLs itself (no CORS restrictions) and decodes HLS natively, like other Samsung IPTV apps. Then the browser's `<video>` element, then [hls.js](https://github.com/video-dev/hls.js/) (bundled, v1.6.19). If a player errors or shows no video within 12 s, the next one is tried. A status line in the player shows which player is in use and every player's error if a channel fails.
- **Native text input** — the playlist URL field is a real input that opens Samsung's system keyboard, so you can also type from your phone with the SmartThings app.

## Remote keys while watching

| Key | Action |
|---|---|
| OK | Open the channel list (over the video) |
| Up / Down, CH+ / CH- | Next / previous channel |
| Left, PRE-CH | Previous channel you watched |
| Right, INFO | Info bar with the Favorite button (OK toggles it) |
| 0-9 | Jump to a channel number (after 2 s, or press OK) |
| Back | Close the panel/info bar, then leave the player |

In the channel list: Up/Down move, CH+/CH- page, OK plays, Back closes. On startup the app reopens the last channel you watched.

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
MyTvApp.wgt           Pre-built UNSIGNED package (sign with your own Samsung certificate)
```

## Building

From the project root:

```bash
# 1. Compile the web content into .buildResult/
tizen build-web -- .

# 2. Package .buildResult/ into a signed .wgt
tizen package -t wgt -s <your-security-profile> -- .buildResult
```

This produces `.buildResult/MyTvApp.wgt`.

## Which install to use

Install the `.wgt` **once**. It contains a small launcher (`launcher.html`) that, on every start, downloads the current app from GitHub Pages (`https://miglworld.github.io/MyTvApp/`, built from `main`) and runs it inside the installed app, so Samsung's AVPlay player keeps working. Merging a pull request into `main` is therefore all it takes to update the TV; no new `.wgt` is needed.

- If GitHub cannot be reached within 5 s, or the downloaded app does not start within 10 s, the launcher starts the copy bundled in the package.
- Settings shows the version and where it was loaded from (GitHub or bundled copy).
- `package.json` `version` is the cache key: **bump it with every change**, or TVs keep the cached files.
- A new `.wgt` is only needed when `launcher.html` or `config.xml` changes.

A TizenBrew module (below) runs as a plain web page without Samsung's TV APIs, so it only has the browser players, which most free IPTV servers block. Use it only to test the interface.

## Install as a TizenBrew module (recommended: updates without reinstalling)

TizenBrew can load this app straight from GitHub, so every push to `main` reaches the TV without rebuilding or re-signing anything.

1. Open **TizenBrew** on the TV, go to the **Module Manager** and choose **Add GitHub Module**.
2. Enter `miglworld/MyTvApp@main` (keep the `@main`: without it the CDN serves the old upstream `v1.0.0` tag, which has no module file).
3. Launch **MyTvApp** from TizenBrew.

Notes:
- Files are served through the jsDelivr CDN, which caches branch files for up to 12 hours, so an update can take that long to appear.
- The module runs inside TizenBrew and keeps its own saved playlists/favorites, separate from an installed `.wgt` copy.
- `package.json` registers only the basic keys (TizenBrew aborts the launch if a key name is rejected); the app registers the rest itself, one by one.

## Installing on a device or emulator

```bash
# Connect to the TV/emulator (skip if already connected)
sdb connect <tv-ip-address>

# Install
tizen install -n MyTvApp.wgt -t <device-id> -- .buildResult
```

Alternatively, install the pre-built `MyTvApp.wgt` from this repo. It is **unsigned**: sign it with your own Samsung certificate (the TizenBrew Installer does this on Tizen 7+, or use `tizen package -t wgt -s <profile>`). If an older copy signed by someone else is installed, uninstall it first or the install fails with "Author certificate not match".

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

# MyTvApp

An IPTV player for Samsung Smart TVs (Tizen). It plays live channels from M3U/M3U8 playlists and is driven entirely with the TV remote.

- **Download:** the `.wgt` attached to the [latest release](https://github.com/miglworld/MyTvApp/releases/latest) (unsigned, see [Installing](#installing))
- **Changes:** [CHANGELOG.md](CHANGELOG.md)

## Features

- **Multiple playlists, several active at once.** Add any number of M3U/M3U8 playlist URLs in Settings and switch each one on or off. Categories from different playlists stay separate, under a header per playlist.
- **One-press iptv-org presets.** Settings offers **+ Add IPTV-ORG Portugal** and **+ Add IPTV-ORG All Countries**, fetched live from `iptv-org.github.io`. No playlist is bundled in the package.
- **Categories and channel grids.** Channels are grouped by `group-title` into an alphabetical two-column list, then a channel grid per category.
- **Favorites.** Star a channel while watching it. Favorites are kept when a playlist is switched off (they are only hidden) and removed when the playlist is deleted.
- **Remote-control navigation.** D-pad, OK and Back everywhere, plus channel up/down, number keys, previous channel and play/pause.
- **Three players with automatic fallback.** In the installed app, Samsung's own player (**AVPlay**) is tried first: it opens streams itself (no CORS limits) and decodes HLS natively. Then the browser's `<video>` element, then [hls.js](https://github.com/video-dev/hls.js/) (bundled, v1.6.19). If a player fails or shows no video within 12 s, the next one is tried. A status line shows the player in use, the stream's resolution and bitrate, and every player's error if a channel fails.
- **Picture tuning (optional, off by default).** A switch at the bottom of Settings. On: the Samsung player starts adaptive streams at their highest quality and keeps the stream's own picture shape. Turn it off if the picture stays black.
- **System keyboard.** The playlist URL field opens Samsung's keyboard, so you can also type from your phone with the SmartThings app.

## Remote keys while watching

| Key | Action |
|---|---|
| OK | Open the channel list (over the video) |
| Up / Down, CH+ / CH- | Next / previous channel |
| Left, PRE-CH | Previous channel you watched |
| Right, INFO | Info bar with the Favorite button (OK toggles it) |
| 0-9 | Jump to a channel number (after 2 s, or press OK) |
| Play/Pause | Pause or resume |
| Back | Close the panel/info bar, then leave the player (back to the channel grid you came from) |

In the channel list: Up/Down move, CH+/CH- page, OK plays, Back closes. On startup the app reopens the last channel you watched.

## Installing

1. Download the `.wgt` from the [latest release](https://github.com/miglworld/MyTvApp/releases/latest), or build it (below).
2. The package is **unsigned**. Sign it with your own Samsung certificate: the TizenBrew Installer does this on Tizen 7+, or use `tizen package -t wgt -s <profile>`.
3. Install it on the TV with the Tizen tools:

```bash
sdb connect <tv-ip-address>
tizen install -n MyTvApp.wgt -t <device-id>
```

Or use the **TizenBrew Installer**: set the TV's Developer Mode Host PC IP to your computer's IP and reboot, enter `miglworld/MyTvApp` in the installer (it takes the package from the latest release and signs it), then set the Host PC IP back to `127.0.0.1` and reboot.

Installing over an earlier version keeps your playlists and favorites. If a copy signed with a different certificate is already installed, uninstall it first, or the install fails with "Author certificate not match".

### As a TizenBrew module (interface testing only)

A TizenBrew module runs as a plain web page without Samsung's TV APIs. It only has the browser players, which most free IPTV servers block, so use it to try the interface, not to watch.

1. In **TizenBrew**, open the **Module Manager** and choose **Add GitHub Module**.
2. Enter `miglworld/MyTvApp@main`. Keep the `@main`: without it the CDN serves the latest release tag, which can be older than `main`.
3. Launch **MyTvApp** from TizenBrew.

Module files come through the jsDelivr CDN, which caches branch files for up to 12 hours. The module keeps its own playlists and favorites, separate from an installed copy.

## How updates work

The package starts the app straight from its own files (`index.html`), the same way as the versions that are known to work on the TV. **To update, install the newer package from the latest release** over the old one; playlists and favorites are kept.

- Settings shows the version and where it was loaded from.
- The screen says "Starting MyTvApp…" until the app runs. If the app script fails, the error is shown in a red box at the bottom of the screen.
- The bottom of Settings lists the last events (start, playlists, player, errors). The list survives a restart.

`launcher.html` is an experiment in updating without reinstalling: as the start page, it downloads the current app from GitHub Pages on every start and falls back to the bundled copy. It is **not used by the package at the moment**, because packages that started through it showed a black screen on a real TV. To try it, set `<content src="launcher.html" />` in `config.xml` and add the file to `scripts/build-wgt.sh`.

## Development

### Project structure

```
config.xml            Tizen widget manifest (app id, privileges, start page)
index.html            The app and the package's start page: all screens as <section> elements
launcher.html         Experimental self-updating start page (not used by the package)
css/style.css         All styling
js/main.js            App logic: focus/navigation, playlists, playback, favorites
lib/hls.min.js        hls.js 1.6.19, bundled (license: lib/hls.LICENSE)
icon.png              App icon referenced by config.xml
package.json          Version and TizenBrew module info
scripts/build-wgt.sh  Builds the unsigned MyTvApp.wgt
.nojekyll             Makes GitHub Pages serve the files as they are
```

There is no build step for the app itself: `index.html` runs as it is, in a desktop browser too (`python3 -m http.server`, then open `index.html`; the Samsung player is not available there).

### Releasing a change

1. Bump the version in **three places**, to the same value: `package.json`, `config.xml`, and `APP_VERSION` in `js/main.js`.
2. Add a line to [CHANGELOG.md](CHANGELOG.md).
3. Merge into `main`.
4. Build the package and attach it to a GitHub release. This is what TVs install:

```bash
./scripts/build-wgt.sh
gh release create v<version> MyTvApp.wgt --title "MyTvApp <version>"
```

`scripts/build-wgt.sh` refuses to build if the three versions differ.

### Building a signed package with the Tizen CLI

Needs [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk.html) (or its CLI tools) with the `tv-samsung` platform, and a signing profile (`tizen security-profiles list`).

```bash
tizen build-web -- .
tizen package -t wgt -s <your-security-profile> -- .buildResult
```

This produces `.buildResult/MyTvApp.wgt`.

### Compatibility notes

- TV browsers are old: the CSS avoids Grid, `gap`, `aspect-ratio` and `inset`, and the JavaScript is plain ES5.
- Remote keys are read by `keyCode`, as in Samsung's own samples.
- The app id in `config.xml` (`wAKjt4yhqx.TVapp`) is what the TV uses to recognise the app. Changing it makes the TV treat it as a different app, with empty playlists and favorites.

## Network dependence

Playlists are fetched from their URL at startup; a load that hangs is stopped after 15 seconds with a message. Channels stream from their own servers, and many free iptv-org streams are offline or geo-blocked at any given time.

## Credits and license

- MyTvApp started from [KaashDev/TVapp](https://github.com/KaashDev/TVapp) and has since been largely rewritten.
- [hls.js](https://github.com/video-dev/hls.js/) is bundled under its own license (`lib/hls.LICENSE`).
- Preset playlists come from [iptv-org](https://github.com/iptv-org/iptv).
- App icon: "Live TV" from the Noun Project.

The original project has no license file, so this repository does not carry an open-source license either.

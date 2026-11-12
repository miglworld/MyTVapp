# MyTvApp

An IPTV player for Samsung Smart TVs (Tizen). It plays live channels from M3U/M3U8 playlists and is driven entirely with the TV remote.

- **Download:** the `.wgt` attached to the [latest release](https://github.com/miglworld/MyTvApp/releases/latest) (unsigned, see [Installing](#installing))
- **Changes:** [CHANGELOG.md](CHANGELOG.md)
- **Security:** [SECURITY.md](SECURITY.md)
- **Why it is built this way:** [docs/decisions.md](docs/decisions.md)

## Features

- **Multiple playlists, several active at once.** Add any number of M3U/M3U8 playlist URLs in Settings and switch each one on or off. Categories from different playlists stay separate, under a header per playlist.
- **One-press iptv-org presets.** Settings offers **+ Add IPTV-ORG Portugal** and **+ Add IPTV-ORG All Countries**, fetched live from `iptv-org.github.io`. No playlist is bundled in the package.
- **Live TV screen.** The channel you rest on plays behind the whole screen. Over it float a side menu (Live TV, Favorites, Settings; Live TV opens its own menu with All channels and every category of your playlists) and a numbered channel list, with the channel's name, group and stream status as a caption. OK hides the panels for full screen, without restarting the stream; Back brings them back.
- **TV Guide.** A menu entry opens a grid of the channels that have a guide: time across, a line for the present, and the highlighted programme's title, times and description at the top. OK on a programme that is on plays the channel.
- **Programme guide (now and next).** For channels the guide covers, the list shows what is on, and the caption adds the times, how far along it is, a short description and what follows. See [Programme guide](#programme-guide) for where the data comes from.
- **Playlist player options.** Some playlists give a channel the browser identity (user agent) its server expects (`#EXTVLCOPT:http-user-agent=...` or a `user-agent` attribute). The Samsung player uses it for that channel; a Settings switch turns this off. The other players cannot change their identity, and a `http-referrer` option cannot be sent at all.
- **Unreliable channels stand back.** Channels a playlist marks as "[Geo-blocked]" or "[Not 24/7]" are shown darker (Settings can hide them, or show them as normal). A channel that did not play on your TV is remembered and shown darker with a note until it plays again.
- **Favorites.** Star a channel while watching it. Favorites are kept when a playlist is switched off (they are only hidden) and removed when the playlist is deleted.
- **Remote-control navigation.** D-pad, OK and Back everywhere, plus channel up/down, number keys, previous channel and play/pause.
- **Three players with automatic fallback.** In the installed app, Samsung's own player (**AVPlay**) is tried first: it opens streams itself (no CORS limits) and decodes HLS natively. Then the browser's `<video>` element, then [hls.js](https://github.com/video-dev/hls.js/) (bundled, v1.6.19). If a player fails or shows no video within 12 s, the next one is tried. The status line shows the stream's resolution and bitrate; which player was used, and each player's error when a channel fails, are in the diagnostics list (Settings, About).
- **Faster channel start (on by default).** A switch in Settings: the Samsung player shows the picture after 2 seconds of buffer instead of its longer default. Turn it off if channels stutter.
- **Picture tuning (optional, off by default).** A switch in Settings, under Playback. On: the Samsung player starts adaptive streams at their highest quality and keeps the stream's own picture shape. Turn it off if the picture stays black.
- **Remembers playlists.** Each playlist is stored on the TV, so channels appear at once when the app opens. A stored copy older than 6 hours is downloaded again in the background; "Reload playlists now" in Settings does it on demand.
- **Settings in sections.** Playlists, Playback, Channels, Updates and About on the left; switches, values and actions on the right, each explained in a sentence when the remote is on it.
- **Updates itself.** The installed app checks GitHub after it starts and downloads newer versions; a version that fails to start is discarded (see [How updates work](#how-updates-work)).
- **System keyboard.** The playlist URL field opens Samsung's keyboard, so you can also type from your phone with the SmartThings app.

## Remote keys

**Live TV screen**

| Key | Action |
|---|---|
| Up / Down | Move through the menu or the channel list |
| Right, OK on Live TV | Open Live TV's menu: All channels and the categories |
| Left, Back (in Live TV's menu) | Back to the main menu |
| Right, OK (on All channels, a category, Favorites) | Go into the channel list |
| Left, Back (in the list) | Open the menu (it folds into a small capsule while you are in the list) |
| OK (in the list) | Full screen |
| Right (in the list) | Add or remove the favorite |
| CH+ / CH- | Page through the list |
| Back (in the main menu) | Exit the app (asks first) |

**TV Guide**

| Key | Action |
|---|---|
| Left / Right | Previous / next programme of the channel (the grid moves on in time) |
| Up / Down, CH+ / CH- | Other channels, at the same time of day |
| OK | Play the channel, when the programme is on now |
| Back, Left at the start | Open the menu |

**Full screen**

| Key | Action |
|---|---|
| OK | Open the channel list (over the video) |
| Up / Down, CH+ / CH- | Next / previous channel |
| Left, PRE-CH | Previous channel you watched |
| Right, INFO | Info bar with the Favorite button (OK toggles it) |
| 0-9 | Jump to a channel number (after 2 s, or press OK) |
| Play/Pause | Pause or resume |
| Back | Close the panel/info bar, then back to the Live TV screen |

In the channel list over the video: Up/Down move, CH+/CH- page, OK plays, Back closes. On startup the list is on the last channel you watched.

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

Install the package once. After that the app updates itself from GitHub.

- The package always starts from its own files (`index.html`, `js/boot.js`).
- A few seconds after the start, the app asks GitHub which commit the `main` branch points at and reads the version there. If it is newer, it downloads the app's page, stylesheet and script **from that one commit** and keeps them in the TV's storage. (Files fetched by branch name can be minutes out of step with each other; a commit cannot.)
- Before storing an update, the app checks that the script is the announced version and that every part of the page it uses is in the downloaded page.
- When an update has been downloaded, a small notice in the top right corner offers **Update now** (the app restarts into it) or **Later** (it is installed the next time the app starts). The notice waits while a channel is full screen.
- **An update that does not start is thrown away** and not downloaded again by itself; the package's own version runs instead. The worst case is one failed start. "Check for updates now" in Settings may try that version once more.
- Settings shows the version and where it runs from (installed package or downloaded update), and has an **Automatic updates** switch. Off also removes a downloaded update.
- Settings, under About, lists the last events (start, playlists, player, updates, errors). The list survives a restart.
- The screen says "Starting MyTvApp…" until the app runs. If the app script fails, the error is shown in a red box at the bottom of the screen.

### Developer mode

**Developer mode** (a switch in Settings, off by default) makes the TV follow the repo's `dev` branch instead of `main`, so a test version can be tried on the TV before it is merged.

- With it on, the TV takes whatever version the `dev` branch holds, as long as it differs from the one running and is newer than the installed package. "Check for updates now" fetches it without restarting the app by hand.
- A test version that does not start is discarded like any other update.
- Turning it off forgets the test version: the next start runs the installed package's version, which then updates to the released one.

A new package is still needed when `config.xml`, `js/boot.js` or `lib/hls.min.js` changes.

## Development

### Project structure

```
config.xml            Tizen widget manifest (app id, privileges, start page)
index.html            The app and the package's start page: all screens as <section> elements
js/boot.js            Starts js/main.js, or a newer downloaded copy of the app
css/style.css         All styling
js/main.js            App logic: focus/navigation, playlists, playback, favorites
lib/hls.min.js        hls.js 1.6.19, bundled (license: lib/hls.LICENSE)
icon.png              App icon referenced by config.xml
package.json          Version and TizenBrew module info
scripts/build-wgt.sh  Builds the unsigned MyTvApp.wgt
scripts/build-guide.js  Builds the small programme guide (run by GitHub on a schedule)
guide/config.json     Which playlists and guide feeds the programme guide is built from
scripts/check.sh      Checks run before every merge (also by GitHub on each pull request)
scripts/test.js       Tests for the playlist reader and version comparison
.nojekyll             Makes GitHub Pages serve the files as they are
```

There is no build step for the app itself: `index.html` runs as it is, in a desktop browser too (`python3 -m http.server`, then open `index.html`; the Samsung player is not available there).

### Checks

TVs update themselves from `main`, so every pull request is checked by GitHub (`.github/workflows/check.yml`) and should only be merged when the check is green. Run the same checks locally with:

```bash
./scripts/check.sh
```

They verify that the scripts parse, that the version is the same in all four places, that the files self-update relies on are intact, that the security rules in [SECURITY.md](SECURITY.md) hold, that the tests pass, and (in a pull request) that the version went up whenever the app's own files changed.

### Releasing a change

1. Bump the version in **four places**, to the same value: `package.json`, `config.xml`, `APP_VERSION` in `js/main.js`, and `BUNDLED_VERSION` in `js/boot.js`.
2. Add a line to [CHANGELOG.md](CHANGELOG.md).
3. Optional: try it on the TV first. Push the work to the `dev` branch (`git push origin HEAD:dev --force-with-lease`), and on a TV with Developer mode on choose "Check for updates now".
4. Open a pull request, wait for the check, and merge into `main`. Installed TVs update themselves on the next start. Afterwards bring `dev` level with `main` again.
5. For a new package (first installs, or a change to `config.xml`, `js/boot.js` or `lib/hls.min.js`), build it and attach it to a GitHub release:

```bash
./scripts/build-wgt.sh
gh release create v<version> MyTvApp.wgt --title "MyTvApp <version>"
```

`scripts/build-wgt.sh` refuses to build if the four versions differ.

### Programme guide

The TV does not read a full programme guide itself: one country's guide is tens of MB. Instead a job in this repository (`.github/workflows/guide.yml`, every four hours) runs `scripts/build-guide.js`, which downloads the guide feeds listed in `guide/config.json`, keeps only the channels of the playlists listed there and the next 48 hours, and publishes the result (about 300 KB) as `guide.json` on the `guide` branch.

- `guide/config.json`: `playlists` (whose channels to keep), `feeds` (XMLTV guide files), `hours`.
- The job only downloads HTTPS addresses on the hosts listed in `ALLOWED_HOSTS` in `scripts/build-guide.js`. A feed on a new server means adding its host there.
- Channels are matched by the playlist's `tvg-id` without its `@...` ending, in lower case.
- The guide data comes from a third-party feed (iptv-epg.org at present) and is republished here in trimmed form. A channel the feed does not cover has no guide.
- To build it by hand: `node scripts/build-guide.js out/guide.json`. To run the job now: `gh workflow run guide.yml`.

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

Playlists are downloaded from their URL the first time and then kept on the TV; later starts use the stored copy and refresh it in the background. A download that hangs is stopped after 15 seconds with a message. Channels stream from their own servers, and many free iptv-org streams are offline or geo-blocked at any given time.

## Credits and license

- MyTvApp started from [KaashDev/TVapp](https://github.com/KaashDev/TVapp) and has since been largely rewritten.
- [hls.js](https://github.com/video-dev/hls.js/) is bundled under its own license (`lib/hls.LICENSE`).
- Preset playlists come from [iptv-org](https://github.com/iptv-org/iptv).
- App icon: "Live TV" from the Noun Project.

The original project has no license file, so this repository does not carry an open-source license either.

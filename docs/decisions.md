# Decisions

Why MyTvApp is built the way it is. One entry per decision that would be expensive to rediscover. Newest first.

## 6. The programme guide is prepared in this repository, not on the TV
*November 2026*

**Context.** A TV Guide needs programme data. Free XMLTV feeds exist, but one country's feed is about 30 MB, their servers do not allow a web page to download from them, and their channel ids only partly match a playlist's.

**Decision.** A scheduled job here (`.github/workflows/guide.yml`, `scripts/build-guide.js`) downloads the feed, keeps the playlists' channels and the next 48 hours, and publishes about 300 KB as `guide.json` on the `guide` branch. The TV downloads that file from GitHub.

**Consequences.** The TV does no heavy work and matching is exact. The repository republishes third-party guide data in trimmed form. Only playlists listed in `guide/config.json` get a guide.

## 5. An update is one exact commit
*November 2026*

**Context.** The updater first fetched files by branch name. GitHub caches each file of a branch separately for minutes (and ignores a version tag in the address), so a TV updating right after a push stored the new script with the old page. Version 0.11.4 changed the menu markup and could not start on the TV in that state.

**Decision.** The app asks GitHub which commit the branch points at, then downloads every file from that commit. Before storing, it checks that the script is the announced version and that every element id the script uses is in the downloaded page. `scripts/check.sh` enforces the same id rule on every pull request.

**Consequences.** Files cannot be out of step. Each check costs one extra request to GitHub's API, which allows 60 an hour per address without signing in.

## 4. One playback for browsing and for full screen
*November 2026*

**Context.** A first layout showed the channel in a small preview window. On the TV that means moving the Samsung player's picture between two rectangles, an operation that had not been tried there, after a week of black-screen problems.

**Decision.** The picture is always full size. On the Live TV screen it lies behind the menu and the channel list, which are translucent panels; full screen only hides the panels. The stream is never restarted and the picture never moves.

**Consequences.** Going full screen is instant. The Samsung player draws its picture outside the page, so the panels cannot blur it there; they are darker instead.

## 3. The app updates itself from storage, and a version that does not start is discarded
*November 2026*

**Context.** Installing a package on the TV is slow (Developer Mode, a computer on the same network). The launcher (decision 2) was the first attempt at avoiding that and failed.

**Decision.** `js/boot.js` is part of the package and never updated. It starts `js/main.js`, or a newer copy of the page, stylesheet and script that the running app downloaded earlier and stored. If a stored copy has not set `MYTVAPP_STARTED` right after it runs, or was still unconfirmed at the next start, it is thrown away and its version is not fetched again by itself.

**Consequences.** Merging into `main` updates TVs. `js/boot.js`, `config.xml` and `lib/hls.min.js` still need a new package. Everything the app is must fit in those three downloaded files, which is why the script is one file.

## 2. The package starts `index.html` directly, not a launcher page
*November 2026*

**Context.** Versions 1.5.0 to 0.8.1 started through `launcher.html`, which downloaded the app from GitHub on every start and built it inside its own page (first with `document.write()`, then with ordinary DOM calls). Both worked in desktop browsers. On the TV every one of those packages showed a black screen; the cause was never identified.

**Decision.** `config.xml` starts `index.html`, as the last working package (1.4.2) did. The launcher was removed.

**Consequences.** The start path is the one known to work on the TV. Self-update had to be solved another way (decision 3).

## 1. The Samsung player is driven as simply as possible
*November 2026*

**Context.** Between 1.4.2 and 0.8.1 the app also asked the Samsung player (AVPlay) for picture size and bitrate from inside the player's own callbacks, and set extra streaming options. The TV showed black screens in that period.

**Decision.** The call order is the plain one: open, display area, listener, prepare, play. The player is never called from inside its callbacks. Picture information is read only when Right or INFO is pressed. Extra options (best start quality, aspect ratio, short buffer, a playlist's user agent) are each a switch in Settings.

**Consequences.** If an option misbehaves on a TV model it can be switched off without a new version. The status line shows resolution only after a key press.

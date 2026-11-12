# Changelog

MyTvApp's own history starts at v0.1. Newest first. Each entry also names the version number the app showed at the time.

## v0.11 (in testing on the `dev` branch)
- New Live TV screen in place of the home, categories and channel grid screens: the channel plays behind the whole screen, with a floating side menu (every category) and a floating numbered channel list over it, and the channel's caption at the bottom.
- One playback for browsing and full screen: OK hides the panels, Back shows them again, and the stream is not restarted.
- New minimal look: black base, rounded glass panels with a light edge, a bright pill for the focused item. The panels blur what is behind them where the browser can (not over the Samsung player's picture, which lies outside the page).
- Full screen: the caption sits at the bottom, and the channel list is a floating glass panel.
- The menu has two levels: Live TV, Favorites and Settings; Live TV opens its own menu (a "‹ Live TV" header, All channels, then the categories) in the same place.
- The menu folds into a small capsule of icons while the remote is in the channel list or on another screen, and opens again with Left.
- Lighter glass with a bright rim, larger curves, round menu and list items.
- New menu icons, drawn as one set: outlines of a TV, a star and a gear with the same line weight.
- Updates are downloaded from one exact commit. Before, the files were fetched by branch name, where GitHub can serve a new script next to an old page for a few minutes; a TV that updated in that window got a version that could not start (this is what happened to 0.11.4). The app also checks that page and script match before storing an update, and "Check for updates now" may retry a version that failed.
- Review fixes: a channel that did not start at the last launch is not started by itself again; a category stays the same category when playlists change; "previous channel" and the channel to start on are the last ones watched full screen, not ones the list passed over; removing a favorite keeps your place in the list; the diagnostics list no longer fills up with channels passed over.
- Faster channel start (Settings switch, on by default): the Samsung player shows the picture after 2 seconds of buffer.
- Plain status texts ("Connecting…", "Playing · 1920x1080 · 4.8 Mbps", "Not available right now…"). Which player was tried and why it failed is in the diagnostics list.
- A channel the first player cannot show is given up on sooner (7 s per fallback instead of 12 s).

## v0.10.1 (2026-11-11)
Security review.
- Only real stream addresses (`http`, `https`, `rtmp`, `rtsp`, `rtp`, `udp`, `mms`) become channels; logos must be web addresses; playlists over 40 MB are refused.
- The update address used for testing can only be changed on a developer's own machine.
- Removed the unused `launcher.html`.
- Repository: security rules and hostile-playlist tests in the checks, the bundled hls.js is verified against the official build, CodeQL scanning, `SECURITY.md`.

## v0.10.0 (2026-11-11)
- Playlists are remembered on the TV: channels appear at once when the app opens, and stored copies older than 6 hours are refreshed in the background. "Reload playlists now" in Settings.
- Developer mode (Settings): follow the `dev` branch to try test versions before they are merged. "Check for updates now" in Settings.
- A failed reload keeps the channels that were already loaded.
- Repository: checks on every pull request (scripts parse, versions match, tests, version bumped).

## v0.9.2 (2026-11-11)
- No changes to the app: a second self-update run on the TV.

## v0.9.1 (2026-11-11)
- No changes to the app: the first version delivered to the TV by self-update, to confirm that it works.

## v0.9.0 (2026-11-11)
- Self-update: the app starts from its own files, checks GitHub in the background, downloads a newer version into storage and runs it from the next start (or restarts into it right away when the app has just opened).
- An update that does not start is discarded and not tried again.
- **Automatic updates** switch in Settings; update events appear in the diagnostics list.
- Needs this package installed once (`js/boot.js` is new).

## v0.8.2 (2026-11-11)
- The package starts the app directly from its own files again, as 1.4.2 did, instead of going through the launcher. Packages that started through the launcher showed a black screen on the TV. Updating means installing the newer package.

## v0.8.1 (2026-11-11)
- The Samsung player is no longer asked for picture size and bitrate from inside its own callbacks, which could freeze it and leave the screen black. Picture info is read only when Right/INFO is pressed.
- The app starts on its home screen. Reopening the last channel at start is now a switch in Settings (off by default), and it skips a channel that did not start the time before.
- Diagnostics: the last events (start, playlists, player, errors) are listed at the bottom of Settings and survive a restart.

## v0.8 (2026-11-11)
*First released as 1.5.2. The app now shows 0.8.0.*
- The app's version number follows this changelog from here on: 1.5.2 became 0.8.0.
- Fixed the black screen on start: the app script starts immediately, and the launcher builds the page without `document.write()`.
- "Starting MyTvApp…" is shown until the app runs; script errors appear on screen.
- The picture settings from v0.7 are now the optional **Picture tuning** switch (off by default).
- Playback restarts when the app returns from the background.
- Messages and the loading spinner are visible on every screen.
- Back from the player returns to the channel grid it was opened from.
- Focus stays on the row after switching or deleting a playlist.
- "Buffering…" clears when the video recovers; channel names with commas in attributes; `#EXTGRP` groups.
- Faster navigation in big channel grids.
- Repository: the built package moved to GitHub Releases, `scripts/build-wgt.sh` added, icon renamed to `icon.png`.

## v0.7 (2026-11-11)
*Released as 1.5.1.*
- The left menu no longer covers the video.
- Samsung player: highest start quality and original aspect ratio.
- Status line shows the stream's resolution and bitrate.

## v0.6 (2026-11-11)
*Released as 1.5.0.*
- Install once: a launcher loads the current app from GitHub Pages on every start, with the bundled copy as fallback.

## v0.5 (2026-11-11)
*Released as 1.4.2.*
- Renamed the app to MyTvApp.

## v0.4 (2026-11-11)
*Released as 1.4.1.*
- Exit works inside TizenBrew.

## v0.3 (2026-11-11)
*Released as 1.4.0.*
- Playback through Samsung's AVPlay in the installed app.

## v0.2 (2026-11-11)
*Released as 1.3.0.*
- Channel list over the video, number zapping, previous channel, reopen the last channel on start.
- TizenBrew module support.

## v0.1 (2026-11-11)
*Released as 1.2.0.*
- Samsung system keyboard instead of the custom on-screen keyboard.
- TV player first, hls.js fallback, 12 s no-video watchdog, on-screen status line.
- hls.js bundled and pinned; channel grids render in batches of 60.
- Removed the bundled 14k-channel playlist (iptv-org presets instead) and the Donate screen.

## Before v0.1
- The app MyTvApp started from: TVapp by KaashDev ([KaashDev/TVapp](https://github.com/KaashDev/TVapp)).

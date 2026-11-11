# Changelog

## 1.5.2 (2026-11-11)
- Fixed the black screen on start: the app script starts immediately, and the launcher builds the page without `document.write()`.
- "Starting MyTvApp…" is shown until the app runs; script errors appear on screen.
- The 1.5.1 picture settings are now the optional **Picture tuning** switch (off by default).
- Playback restarts when the app returns from the background.
- Messages and the loading spinner are visible on every screen.
- Back from the player returns to the channel grid it was opened from.
- Focus stays on the row after switching or deleting a playlist.
- "Buffering…" clears when the video recovers; channel names with commas in attributes; `#EXTGRP` groups.
- Faster navigation in big channel grids.
- Repository: the built package moved to GitHub Releases, `scripts/build-wgt.sh` added, icon renamed to `icon.png`.

## 1.5.1 (2026-11-11)
- The left menu no longer covers the video.
- Samsung player: highest start quality and original aspect ratio.
- Status line shows the stream's resolution and bitrate.

## 1.5.0 (2026-11-11)
- Install once: a launcher loads the current app from GitHub Pages on every start, with the bundled copy as fallback.

## 1.4.2 (2026-11-11)
- Renamed the app to MyTvApp.

## 1.4.1 (2026-11-11)
- Exit works inside TizenBrew.

## 1.4.0 (2026-11-11)
- Playback through Samsung's AVPlay in the installed app.

## 1.3.0 (2026-11-11)
- Channel list over the video, number zapping, previous channel, reopen the last channel on start.
- TizenBrew module support.

## 1.2.0 (2026-11-11)
- Samsung system keyboard instead of the custom on-screen keyboard.
- TV player first, hls.js fallback, 12 s no-video watchdog, on-screen status line.
- hls.js bundled and pinned; channel grids render in batches of 60.
- Removed the bundled 14k-channel playlist (iptv-org presets instead) and the Donate screen.

## Earlier
- Original app by KaashDev ([KaashDev/TVapp](https://github.com/KaashDev/TVapp)).

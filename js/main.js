// Runs as soon as it is loaded: this script is the last element of <body>, so
// the whole page already exists. (It used to wait for DOMContentLoaded, which
// is not guaranteed to fire when the launcher builds the page itself.)
(function (main) {
    try { main(); } catch (e) {
        // A TV has no console to look at: put the error on the screen.
        var where = ((e && e.stack) || '').split('\n')[1] || '';
        if (window.MYTVAPP_ERROR) window.MYTVAPP_ERROR(((e && e.message) || String(e)) + ' ' + where.trim());
        if (window.console) console.error(e);
    }
})(function () {
    'use strict';

    // ==========================================================================
    // Config / constants
    // ==========================================================================
    var APP_VERSION = '0.9.0';
    var PLAYLISTS_KEY = 'iptv_playlists';
    var ACTIVE_PLAYLISTS_KEY = 'iptv_active_playlist_id';
    var FAVORITES_KEY = 'iptv_favorites';
    var LAST_CHANNEL_KEY = 'iptv_last_channel';
    var PICTURE_TUNING_KEY = 'iptv_picture_tuning';
    var REOPEN_LAST_KEY = 'iptv_reopen_last';
    var REOPEN_PENDING_KEY = 'iptv_reopen_pending';
    var LOG_KEY = 'iptv_log';

    // Self-update: where the current app is published (GitHub Pages, served
    // from the repo's main branch) and where a downloaded copy is kept. The
    // keys are shared with js/boot.js, which starts a downloaded copy.
    var UPDATE_URL = 'https://miglworld.github.io/MyTvApp/';
    var UPDATE_KEY = 'mytvapp_update';
    var UPDATE_BAD_KEY = 'mytvapp_update_bad';
    var UPDATE_URL_KEY = 'mytvapp_update_url';   // testing only: another address to update from
    var AUTO_UPDATE_KEY = 'iptv_auto_update';
    var UPDATE_CHECK_DELAY_MS = 3000;
    var UPDATE_RESTART_WINDOW_MS = 25000;
    var LOG_LINES = 14;
    var OVERLAY_HIDE_MS = 5000;
    var TOAST_MS = 3000;
    var FETCH_TIMEOUT_MS = 15000;

    // The bundled 14k-channel playlist was removed from the package. The ids/
    // URLs below identify it so older installs can drop the stale entry.
    var LEGACY_BUILTIN_ID = 'default';
    var LEGACY_BUILTIN_URL = 'playlists/index.country.m3u';

    // One-press presets on the Playlists screen (iptv-org public playlists).
    var PRESET_PLAYLISTS = [
        { name: 'IPTV-ORG Portugal', url: 'https://iptv-org.github.io/iptv/countries/pt.m3u' },
        { name: 'IPTV-ORG All Countries', url: 'https://iptv-org.github.io/iptv/index.country.m3u' }
    ];

    // Channel tiles are rendered in batches: categories in big playlists hold
    // 1,000-2,000 channels, and building every tile (plus loading every logo)
    // at once stalls a TV browser. More tiles are appended as focus nears the end.
    var CHANNEL_BATCH = 60;

    // Playback error handling limits — a dead stream gives up with a message
    // instead of retrying forever.
    var MAX_NETWORK_RETRIES = 3;
    var MAX_MEDIA_RECOVERIES = 2;

    // Samsung IME key codes (developer.samsung.com keyboard/IME guide).
    var IME_DONE = 65376;
    var IME_CANCEL = 65385;

    // Player: rows visible in the channel-list panel, and how long a typed
    // channel number waits for more digits before jumping.
    var PANEL_ROWS = 11;
    var NUMBER_ENTRY_MS = 2000;

    // ==========================================================================
    // State
    // ==========================================================================
    var state = {
        playlists: [],
        activePlaylistIds: [],
        channels: [],
        categories: [],          // [{ name, code, channels: [...] }] — grouped by group-title
        activeCategoryIndex: 0,
        favorites: [],
        nowPlaying: null,
        zapContext: 'category',  // 'category' | 'favorites'
        zapList: [],
        hls: null,
        overlayTimeoutId: null,
        toastTimeoutId: null,
        renderedChannelCount: 0,
        playToken: 0,
        isPlaying: false,
        engine: null,
        enginesLeft: [],
        playErrors: [],
        playFailed: false,
        watchdogId: null,
        avplayOpen: false,
        quality: '',             // picture size / bitrate last read from the player
        returnTo: null,          // screen + focus to go back to when the player closes
        prevChannel: null,       // { ch, context, list } for the "previous channel" key
        lastExited: null,        // channel showing when the player was closed
        panelOpen: false,
        panelIndex: 0,
        infoInteractive: false,  // Right/Info pressed: favorite button has focus
        digitBuffer: '',
        digitTimer: null
    };

    var editingPlaylistId = null;

    // Optional Samsung player settings (Settings screen). Off by default: the
    // plain player is the configuration known to show a picture on every TV.
    var pictureTuning = false;
    try { pictureTuning = localStorage.getItem(PICTURE_TUNING_KEY) === '1'; } catch (e) { pictureTuning = false; }

    // Reopen the last watched channel when the app starts. Off by default:
    // the app then always starts on its own screens, so a channel or player
    // problem can never look like an app that does not start.
    var reopenLast = false;
    try { reopenLast = localStorage.getItem(REOPEN_LAST_KEY) === '1'; } catch (e) { reopenLast = false; }

    // Automatic updates (Settings switch, on by default).
    var autoUpdate = true;
    try { autoUpdate = localStorage.getItem(AUTO_UPDATE_KEY) !== '0'; } catch (e) { autoUpdate = true; }
    var updateReady = '';   // version downloaded and waiting for the next start
    var bootTime = Date.now();

    // Diagnostics: a TV has no console, so the last few events are kept in
    // storage and listed at the bottom of Settings. They survive a restart,
    // which is what makes a freeze or a black screen explainable afterwards.
    function readLog() {
        try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { return []; }
    }
    function logEvent(msg) {
        try {
            var d = new Date();
            var two = function (n) { return (n < 10 ? '0' : '') + n; };
            var lines = readLog();
            lines.push(two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + String(msg).slice(0, 160));
            if (lines.length > LOG_LINES) lines = lines.slice(lines.length - LOG_LINES);
            localStorage.setItem(LOG_KEY, JSON.stringify(lines));
        } catch (e) { /* non-fatal */ }
    }
    // Script errors go to the log as well as the on-screen box.
    if (window.MYTVAPP_ERROR && !window.MYTVAPP_ERROR.logged) {
        var showError = window.MYTVAPP_ERROR;
        window.MYTVAPP_ERROR = function (text) { logEvent('ERROR ' + text); showError(text); };
        window.MYTVAPP_ERROR.logged = true;
    }

    var videoPlayer = document.getElementById('videoPlayer');

    // ==========================================================================
    // Remote control keys — ChannelUp/Down and MediaPlayPause need explicit
    // registration. Arrow/Enter/Back are automatic on Tizen TVs.
    // ==========================================================================
    if (window.tizen && tizen.tvinputdevice) {
        // Registered one by one: registerKeyBatch fails as a whole if the TV
        // does not support any single key in the list (e.g. no number pad).
        ['ChannelUp', 'ChannelDown', 'MediaPlayPause', 'PreviousChannel', 'ChannelList', 'Info',
         '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (k) {
            try { tizen.tvinputdevice.registerKey(k); } catch (e) { console.warn('registerKey failed:', k); }
        });
    }

    // ==========================================================================
    // Focus manager — zones backed by a matrix (array of rows) of elements.
    // ==========================================================================
    var Focus = {
        zones: {},
        currentZone: null,
        row: 0,
        col: 0,

        setZone: function (name, row, col) {
            this.currentZone = name;
            this.row = row || 0;
            this.col = col || 0;
            this.apply();
        },

        getMatrix: function () {
            var zone = this.zones[this.currentZone];
            return zone ? zone.getMatrix() : [];
        },

        apply: function () {
            var focused = document.querySelectorAll('.focused');
            for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');

            var matrix = this.getMatrix();
            if (!matrix.length) return;
            if (this.row >= matrix.length) this.row = matrix.length - 1;
            if (this.row < 0) this.row = 0;
            var rowArr = matrix[this.row] || [];
            if (this.col >= rowArr.length) this.col = rowArr.length - 1;
            if (this.col < 0) this.col = 0;

            var el = rowArr[this.col];
            if (el) {
                el.classList.add('focused');
                el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
            var zone = this.zones[this.currentZone];
            if (zone && zone.afterApply) zone.afterApply(this.row, matrix.length);
        },

        move: function (dir) {
            var zone = this.zones[this.currentZone];
            if (!zone) return;
            var matrix = this.getMatrix();
            if (!matrix.length) return;
            var rowArr = matrix[this.row] || [];

            if (dir === 'left') {
                if (this.col > 0) { this.col--; this.apply(); }
                else if (zone.onEdge) zone.onEdge('left');
            } else if (dir === 'right') {
                if (this.col < rowArr.length - 1) { this.col++; this.apply(); }
                else if (zone.onEdge) zone.onEdge('right');
            } else if (dir === 'up') {
                if (this.row > 0) { this.row--; this.apply(); }
                else if (zone.onEdge) zone.onEdge('up');
            } else if (dir === 'down') {
                if (this.row < matrix.length - 1) { this.row++; this.apply(); }
                else if (zone.onEdge) zone.onEdge('down');
            }
        },

        select: function () {
            var matrix = this.getMatrix();
            var rowArr = matrix[this.row];
            var el = rowArr && rowArr[this.col];
            if (el) el.click();
        }
    };

    // Groups elements into visual rows by comparing their actual rendered
    // offsetTop, instead of assuming a fixed column count from pixel math.
    // This stays correct regardless of tile size, padding, or screen width —
    // a hardcoded column count silently drifts out of sync with the real
    // flex-wrap layout the moment either one changes.
    function rowsByLayout(elements) {
        var rows = [];
        var currentRow = [];
        var currentTop = null;
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (currentTop === null || el.offsetTop === currentTop) {
                currentRow.push(el);
            } else {
                rows.push(currentRow);
                currentRow = [el];
            }
            currentTop = el.offsetTop;
        }
        if (currentRow.length) rows.push(currentRow);
        return rows;
    }

    // Row layout per grid, reused between key presses. Reading offsetTop of
    // up to 2,000 tiles on every arrow press is slow on a TV; the layout only
    // changes when the tiles do (re-render or a new batch appended).
    var layoutCache = {};
    function cachedRows(key, selector) {
        var els = document.querySelectorAll(selector);
        var c = layoutCache[key];
        if (c && c.count === els.length && c.first === els[0]) return c.rows;
        var rows = rowsByLayout(els);
        // A hidden grid has no layout (every offsetTop is 0): do not keep that.
        if (els.length && els[0].offsetParent !== null) layoutCache[key] = { count: els.length, first: els[0], rows: rows };
        return rows;
    }

    function leftEdgeToRail(zoneName) {
        Focus.zones[zoneName].onEdge = (function (existing) {
            return function (dir) {
                if (dir === 'left') {
                    Focus.setZone('iconRail', currentRailRow(), 0);
                } else if (existing) {
                    existing(dir);
                }
            };
        })(Focus.zones[zoneName].onEdge);
    }

    function currentRailRow() {
        if (document.getElementById('screen-categories').classList.contains('active') ||
            document.getElementById('screen-category-channels').classList.contains('active')) return 1;
        if (document.getElementById('screen-settings').classList.contains('active')) return 2;
        return 0;
    }

    // ==========================================================================
    // UI feedback helpers — loading indicator and toast popup
    // ==========================================================================
    function showLoading(visible) {
        document.getElementById('loadingIndicator').hidden = !visible;
    }

    // window.confirm() is not usable here: this UI is driven entirely by
    // synthetic clicks from remote-control key events (see Focus below), and
    // Tizen's WebKit does not expose the native confirm dialog to that D-pad
    // navigation. This modal is just another Focus zone instead.
    var pendingConfirmCallback = null;
    var confirmReturnZone = null;

    function showConfirm(message, confirmLabel, onConfirm) {
        confirmReturnZone = { name: Focus.currentZone, row: Focus.row, col: Focus.col };
        pendingConfirmCallback = onConfirm;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmYesBtn').textContent = confirmLabel;
        document.getElementById('confirmModal').hidden = false;
        Focus.setZone('confirmActions', 0, 0);
    }

    function hideConfirm() {
        document.getElementById('confirmModal').hidden = true;
        pendingConfirmCallback = null;
        if (confirmReturnZone) Focus.setZone(confirmReturnZone.name, confirmReturnZone.row, confirmReturnZone.col);
    }

    Focus.zones.confirmActions = {
        getMatrix: function () {
            return [[document.getElementById('confirmCancelBtn'), document.getElementById('confirmYesBtn')]];
        }
    };

    document.getElementById('confirmCancelBtn').addEventListener('click', hideConfirm);
    document.getElementById('confirmYesBtn').addEventListener('click', function () {
        var cb = pendingConfirmCallback;
        hideConfirm();
        if (cb) cb();
    });

    function showToast(message) {
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('visible');
        if (state.toastTimeoutId) clearTimeout(state.toastTimeoutId);
        state.toastTimeoutId = setTimeout(function () { toast.classList.remove('visible'); }, TOAST_MS);
    }

    // ==========================================================================
    // Screen switching
    // ==========================================================================
    function showScreen(id) {
        var screens = document.querySelectorAll('.screen');
        for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
        document.getElementById(id).classList.add('active');
    }

    function setNavActive(id) {
        document.getElementById('navHome').classList.toggle('active', id === 'screen-grid');
        document.getElementById('navCategories').classList.toggle('active', id === 'screen-categories' || id === 'screen-category-channels');
        document.getElementById('navSettings').classList.toggle('active', id === 'screen-settings');
    }

    function activeScreenId() {
        var el = document.querySelector('.screen.active');
        return el ? el.id : '';
    }

    function switchToScreen(id) {
        showScreen(id);
        setNavActive(id);

        if (id === 'screen-grid') {
            Focus.setZone(visibleFavorites().length ? 'favoritesRow' : 'iconRail', 0, 0);
        } else if (id === 'screen-categories') {
            renderCategoriesScreen();
            Focus.setZone(state.categories.length ? 'categoriesGrid' : 'iconRail', state.categories.length ? 0 : 1, 0);
        } else if (id === 'screen-settings') {
            renderPlaylistList();
            renderAppVersion();
            Focus.setZone('playlistList', 0, 0);
        }
    }

    document.getElementById('navHome').addEventListener('click', function () { switchToScreen('screen-grid'); });
    document.getElementById('navCategories').addEventListener('click', function () { switchToScreen('screen-categories'); });
    document.getElementById('navSettings').addEventListener('click', function () { switchToScreen('screen-settings'); });

    Focus.zones.iconRail = {
        getMatrix: function () {
            return [[document.getElementById('navHome')], [document.getElementById('navCategories')], [document.getElementById('navSettings')]];
        },
        onEdge: function (dir) {
            if (dir !== 'right') return;
            if (document.getElementById('screen-categories').classList.contains('active') && state.categories.length) {
                Focus.setZone('categoriesGrid', 0, 0);
            } else if (document.getElementById('screen-category-channels').classList.contains('active')) {
                Focus.setZone('categoryChannelsGrid', 0, 0);
            } else if (document.getElementById('screen-settings').classList.contains('active')) {
                Focus.setZone('playlistList', 0, 0);
            } else if (visibleFavorites().length) {
                Focus.setZone('favoritesRow', 0, 0);
            }
        }
    };

    // ==========================================================================
    // M3U parsing
    // ==========================================================================
    function parseM3U(text) {
        var lines = text.split(/\r?\n/);
        var channels = [];
        var pending = null;
        var attrRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;

            if (line.indexOf('#EXTINF') === 0) {
                var attrs = {};
                var m;
                attrRegex.lastIndex = 0;
                while ((m = attrRegex.exec(line)) !== null) attrs[m[1].toLowerCase()] = m[2];
                // The name follows the first comma that is outside quotes
                // (attribute values such as group-title="News, Sport" have commas too).
                var comma = -1;
                var inQuote = false;
                for (var c = 0; c < line.length; c++) {
                    var chr = line.charAt(c);
                    if (chr === '"') inQuote = !inQuote;
                    else if (chr === ',' && !inQuote) { comma = c; break; }
                }
                if (comma === -1) comma = line.lastIndexOf(',');
                var name = comma === -1 ? '' : line.slice(comma + 1).trim();
                pending = {
                    name: name || 'Unnamed Channel',
                    logo: attrs['tvg-logo'] || '',
                    group: attrs['group-title'] || 'Other',
                    tvgId: attrs['tvg-id'] || '',
                    tvgCountry: attrs['tvg-country'] || '',
                    chno: attrs['tvg-chno'] || ''
                };
            } else if (line.indexOf('#EXTGRP:') === 0) {
                // Group given on its own line instead of group-title.
                if (pending && pending.group === 'Other') pending.group = line.slice(8).trim() || 'Other';
            } else if (line.indexOf('#') !== 0) {
                if (pending) { pending.url = line; channels.push(pending); pending = null; }
            }
        }
        return channels;
    }

    // Categories are grouped per source playlist (not merged across
    // playlists that happen to share a group-title) so multiple active
    // playlists stay visually separate, per playlist, on the Categories screen.
    function rebuildCategories() {
        var order = [];
        var byPlaylist = {};
        state.channels.forEach(function (ch) {
            var pid = ch.playlistId || '';
            if (!byPlaylist[pid]) { byPlaylist[pid] = {}; order.push(pid); }
            var key = ch.group || 'Other';
            if (!byPlaylist[pid][key]) {
                byPlaylist[pid][key] = { name: key, code: ch.tvgCountry || '', channels: [], playlistId: pid, playlistName: ch.playlistName || '' };
            }
            byPlaylist[pid][key].channels.push(ch);
        });
        state.categories = [];
        order.forEach(function (pid) {
            var groups = Object.keys(byPlaylist[pid]).map(function (k) { return byPlaylist[pid][k]; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
            state.categories = state.categories.concat(groups);
        });
        state.activeCategoryIndex = 0;
    }

    // ==========================================================================
    // Playlists (multiple, persisted; add/edit/delete via Settings). The
    // built-in default is the real iptv-org country-indexed catalog, not a
    // local test stub.
    // ==========================================================================
    function loadPlaylistsFromStorage() {
        var stored = null;
        try { stored = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || 'null'); } catch (e) { stored = null; }
        state.playlists = (stored && stored.length) ? stored : [];

        // Drop the old bundled playlist entry left in storage by earlier builds —
        // its file no longer exists in the package, so it would only ever fail.
        var before = state.playlists.length;
        state.playlists = state.playlists.filter(function (p) {
            return p.id !== LEGACY_BUILTIN_ID && p.url !== LEGACY_BUILTIN_URL;
        });
        if (state.playlists.length !== before) savePlaylists();

        var raw = null;
        try { raw = localStorage.getItem(ACTIVE_PLAYLISTS_KEY); } catch (e) { raw = null; }
        var storedActive;
        if (raw === null) {
            storedActive = [];
        } else {
            try {
                var parsed = JSON.parse(raw);
                storedActive = Array.isArray(parsed) ? parsed : [raw];
            } catch (e) {
                // Pre-multi-playlist storage held a single id as a bare string,
                // not JSON — JSON.parse throws on it, so fall back to that raw value.
                storedActive = [raw];
            }
        }
        var validIds = state.playlists.map(function (p) { return p.id; });
        state.activePlaylistIds = storedActive.filter(function (id) { return validIds.indexOf(id) !== -1; });
    }

    function savePlaylists() {
        try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(state.playlists)); } catch (e) { /* non-fatal */ }
    }

    function saveActivePlaylistIds() {
        try { localStorage.setItem(ACTIVE_PLAYLISTS_KEY, JSON.stringify(state.activePlaylistIds)); } catch (e) { /* non-fatal */ }
    }

    function deriveNameFromUrl(url) {
        try {
            var u = new URL(url);
            var last = u.pathname.split('/').filter(Boolean).pop();
            return u.hostname + (last ? ' / ' + last : '');
        } catch (e) {
            return url.length > 40 ? url.slice(0, 40) + '…' : url;
        }
    }

    // Fetches every currently-active playlist in parallel and merges their
    // channels. Each playlist is fetched/parsed independently — one bad URL
    // shows an error for that playlist without blanking out the others.
    // Used only for the initial bulk load at boot; interactive add/toggle/
    // remove use the targeted helpers below instead, so a single playlist
    // change doesn't have to wait on (or re-fetch) every other active one.
    // A hung fetch (no route to the host, rather than a fast connection
    // refusal) would otherwise never resolve or reject, leaving the loading
    // indicator stuck on screen forever with nothing left to clear it.
    function fetchWithTimeout(url) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            // Where supported, also cancel the download itself on timeout.
            var ctrl = window.AbortController ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
                reject(new Error('Timed out'));
            }, FETCH_TIMEOUT_MS);
            fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(res);
            }, function (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    function fetchPlaylistChannels(pl) {
        return fetchWithTimeout(pl.url)
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
            .then(function (text) {
                var parsed = parseM3U(text);
                if (!parsed.length) throw new Error('No channels found');
                // Channel number: the playlist's tvg-chno when present, else list position.
                parsed.forEach(function (ch, i) {
                    ch.playlistId = pl.id;
                    ch.playlistName = pl.name;
                    ch.number = parseInt(ch.chno, 10) || (i + 1);
                });
                return parsed;
            });
    }

    function refreshActiveChannels(options) {
        options = options || {};
        var activePlaylists = state.playlists.filter(function (p) { return state.activePlaylistIds.indexOf(p.id) !== -1; });

        if (!activePlaylists.length) {
            state.channels = [];
            rebuildCategories();
            renderHero();
            renderFavoritesRow();
            showLoading(false);
            if (options.screen) switchToScreen(options.screen);
            if (options.after) options.after();
            return;
        }

        showLoading(true);
        Promise.all(activePlaylists.map(function (pl) {
            return fetchPlaylistChannels(pl)
                .then(function (channels) { return { channels: channels, error: null, name: pl.name }; })
                .catch(function (err) { return { channels: [], error: err, name: pl.name }; });
        })).then(function (results) {
            var allChannels = [];
            var failures = [];
            results.forEach(function (r) {
                if (r.error) failures.push(r.name + ': ' + r.error.message);
                else allChannels = allChannels.concat(r.channels);
            });
            state.channels = allChannels;
            rebuildCategories();
            renderHero();
            renderFavoritesRow();
            showLoading(false);
            logEvent('playlists: ' + allChannels.length + ' channels' + (failures.length ? ', failed: ' + failures.join('; ') : ''));
            if (failures.length) showToast('Could not load ' + failures.join('; '));
            if (options.screen) switchToScreen(options.screen);
            if (options.after) options.after();
        });
    }

    // Instantly drops a playlist's channels from the merged list — no
    // network round-trip needed since the remaining playlists' channels are
    // already loaded in memory.
    function removeChannelsForPlaylist(playlistId) {
        state.channels = state.channels.filter(function (ch) { return ch.playlistId !== playlistId; });
        rebuildCategories();
        renderHero();
        renderFavoritesRow();
    }

    // Fetches one playlist and merges its channels in, replacing any it
    // already contributed (e.g. re-activating it, or after editing its URL).
    function loadChannelsForPlaylist(pl) {
        showLoading(true);
        return fetchPlaylistChannels(pl)
            .then(function (channels) {
                state.channels = state.channels.filter(function (ch) { return ch.playlistId !== pl.id; }).concat(channels);
                rebuildCategories();
                renderHero();
                renderFavoritesRow();
                showLoading(false);
                return null;
            })
            .catch(function (err) {
                state.channels = state.channels.filter(function (ch) { return ch.playlistId !== pl.id; });
                rebuildCategories();
                renderHero();
                renderFavoritesRow();
                showLoading(false);
                return err;
            });
    }

    // ==========================================================================
    // Favorites — the saved list persists regardless of which playlists are
    // active (deactivating a playlist doesn't delete its favorites, only
    // deleting the playlist does), but what's actually *shown* is filtered
    // to favorites whose playlist is currently active, same as Categories.
    // ==========================================================================
    function loadFavorites() {
        try {
            var raw = localStorage.getItem(FAVORITES_KEY);
            state.favorites = raw ? JSON.parse(raw) : [];
        } catch (e) { state.favorites = []; }
    }

    function saveFavorites() {
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); } catch (e) { /* non-fatal */ }
    }

    function visibleFavorites() {
        return state.favorites.filter(function (f) {
            if (!f.playlistId || state.activePlaylistIds.indexOf(f.playlistId) !== -1) return true;
            // Favorites whose playlist no longer exists (e.g. the removed built-in
            // list) keep their direct stream URL, so they stay visible and playable.
            return !state.playlists.some(function (p) { return p.id === f.playlistId; });
        });
    }

    function isFavorited(ch) {
        return state.favorites.some(function (f) { return f.url === ch.url; });
    }

    function toggleFavorite(ch) {
        if (!ch) return;
        var idx = state.favorites.findIndex(function (f) { return f.url === ch.url; });
        if (idx === -1) {
            state.favorites.push({ name: ch.name, url: ch.url, logo: ch.logo, group: ch.group, tvgCountry: ch.tvgCountry, playlistId: ch.playlistId, number: ch.number });
            showToast('Added to Favorites');
        } else {
            state.favorites.splice(idx, 1);
            showToast('Removed from Favorites');
        }
        saveFavorites();
        renderFavoritesRow();
        updateFavoriteButton();
    }

    // ==========================================================================
    // Hero banner
    // ==========================================================================
    function renderHero() {
        var featured = visibleFavorites()[0] || (state.categories[0] && state.categories[0].channels[0]) || null;
        var bg = document.getElementById('heroBg');
        var title = document.getElementById('heroTitle');
        var subtitle = document.getElementById('heroSubtitle');

        if (!featured) {
            bg.style.backgroundImage = '';
            title.textContent = 'MyTvApp';
            subtitle.textContent = 'Add a playlist to get started';
            return;
        }

        bg.style.backgroundImage = featured.logo ? ('url(' + JSON.stringify(featured.logo) + ')') : '';
        title.textContent = featured.name;
        subtitle.textContent = featured.group || '';
    }

    // ==========================================================================
    // Rendering — Favorites row (Home screen)
    // ==========================================================================
    function renderFavoritesRow() {
        var row = document.getElementById('favoritesRow');
        row.innerHTML = '';

        var visible = visibleFavorites();
        if (!visible.length) {
            var hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = 'No favorites yet — press the Favorite button while watching a channel';
            row.appendChild(hint);
            return;
        }

        visible.forEach(function (ch) {
            row.appendChild(buildChannelTile(ch, function () { playChannel(ch, 'favorites'); }));
        });
    }

    Focus.zones.favoritesRow = {
        getMatrix: function () { return [Array.prototype.slice.call(document.querySelectorAll('#favoritesRow .channel-tile'))]; }
    };
    leftEdgeToRail('favoritesRow');

    // ==========================================================================
    // Rendering — Categories browse screen. A two-column alphabetical list:
    // more scannable than tiles for 100+ text entries with no imagery, and
    // the row-pair layout (two per row, filled in order) keeps vertical
    // scrolling to half of a single-column list.
    // ==========================================================================
    function renderCategoriesScreen() {
        var grid = document.getElementById('categoriesGrid');
        grid.innerHTML = '';

        if (!state.categories.length) {
            var hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = 'No channels yet — activate a playlist in Settings';
            grid.appendChild(hint);
            return;
        }

        var section = null;
        var lastPlaylistId = null;
        var frag = document.createDocumentFragment();
        state.categories.forEach(function (cat, i) {
            if (cat.playlistId !== lastPlaylistId) {
                lastPlaylistId = cat.playlistId;
                var header = document.createElement('div');
                header.className = 'category-section-header';
                header.textContent = cat.playlistName || 'Playlist';
                frag.appendChild(header);

                section = document.createElement('div');
                section.className = 'category-section-grid';
                frag.appendChild(section);
            }

            var row = document.createElement('button');
            row.className = 'category-row-item';
            row.tabIndex = -1;

            var letter = document.createElement('span');
            letter.className = 'category-letter';
            letter.textContent = cat.name.charAt(0).toUpperCase();
            row.appendChild(letter);

            var label = document.createElement('span');
            label.className = 'category-label';
            label.textContent = cat.name;
            row.appendChild(label);

            var count = document.createElement('span');
            count.className = 'category-count';
            count.textContent = cat.channels.length;
            row.appendChild(count);

            row.addEventListener('click', function () { openCategoryChannels(i); });
            section.appendChild(row);
        });
        grid.appendChild(frag);
    }

    Focus.zones.categoriesGrid = {
        getMatrix: function () { return cachedRows('categories', '#categoriesGrid .category-row-item'); }
    };
    leftEdgeToRail('categoriesGrid');

    // ==========================================================================
    // Rendering — Channels within a selected category
    // ==========================================================================
    function openCategoryChannels(index) {
        state.activeCategoryIndex = index;
        renderCategoryChannelsScreen();
        showScreen('screen-category-channels');
        setNavActive('screen-category-channels');
        Focus.setZone('categoryChannelsGrid', 0, 0);
    }

    function renderCategoryChannelsScreen() {
        var cat = state.categories[state.activeCategoryIndex];
        document.getElementById('categoryChannelsTitle').textContent = cat ? cat.name + ' Channels' : 'Channels';
        var grid = document.getElementById('categoryChannelsGrid');
        grid.innerHTML = '';
        state.renderedChannelCount = 0;
        if (!cat) return;
        appendChannelBatch();
    }

    function appendChannelBatch() {
        var cat = state.categories[state.activeCategoryIndex];
        if (!cat) return false;
        var start = state.renderedChannelCount;
        var end = Math.min(start + CHANNEL_BATCH, cat.channels.length);
        if (start >= end) return false;
        var grid = document.getElementById('categoryChannelsGrid');
        var frag = document.createDocumentFragment();
        for (var i = start; i < end; i++) {
            (function (ch) {
                frag.appendChild(buildChannelTile(ch, function () { playChannel(ch, 'category'); }));
            })(cat.channels[i]);
        }
        grid.appendChild(frag);
        state.renderedChannelCount = end;
        return true;
    }

    Focus.zones.categoryChannelsGrid = {
        getMatrix: function () { return cachedRows('channels', '#categoryChannelsGrid .channel-tile'); },
        // Load the next batch when focus reaches the last two rendered rows.
        afterApply: function (row, rowCount) {
            if (row >= rowCount - 2) appendChannelBatch();
        }
    };
    leftEdgeToRail('categoryChannelsGrid');

    // ==========================================================================
    // Shared channel tile builder
    // ==========================================================================
    function buildChannelTile(ch, onClick) {
        var tile = document.createElement('button');
        tile.className = 'channel-tile';
        tile.tabIndex = -1;
        tile.__channel = ch;

        var thumb = document.createElement('div');
        thumb.className = 'tile-thumb';
        if (ch.logo) {
            thumb.style.backgroundImage = 'url(' + JSON.stringify(ch.logo) + ')';
        } else {
            thumb.appendChild(fallbackLetter(ch.name));
        }
        thumb.appendChild(liveBadge());
        if (isFavorited(ch)) {
            var star = document.createElement('div');
            star.className = 'fav-badge';
            star.textContent = '\u2605';
            thumb.appendChild(star);
        }

        var nameEl = document.createElement('div');
        nameEl.className = 'tile-name';
        nameEl.textContent = ch.name;

        tile.appendChild(thumb);
        tile.appendChild(nameEl);
        tile.addEventListener('click', onClick);
        return tile;
    }

    function liveBadge() {
        var el = document.createElement('div');
        el.className = 'live-badge';
        el.textContent = 'LIVE';
        return el;
    }

    function fallbackLetter(name) {
        var el = document.createElement('div');
        el.className = 'tile-fallback';
        el.textContent = (name || '?').charAt(0).toUpperCase();
        return el;
    }

    // ==========================================================================
    // Settings screen — playlist list with explicit Edit / Delete buttons
    // ==========================================================================
    function renderPlaylistList() {
        var list = document.getElementById('playlistList');
        list.innerHTML = '';

        state.playlists.forEach(function (pl) {
            var isActive = state.activePlaylistIds.indexOf(pl.id) !== -1;

            var wrapper = document.createElement('div');
            wrapper.className = 'playlist-row-wrapper';

            var main = document.createElement('button');
            main.className = 'playlist-row' + (isActive ? ' active' : '');
            main.tabIndex = -1;

            var checkbox = document.createElement('span');
            checkbox.className = 'playlist-checkbox' + (isActive ? ' checked' : '');
            checkbox.textContent = isActive ? '✓' : '';
            main.appendChild(checkbox);

            var textWrap = document.createElement('div');
            textWrap.className = 'playlist-row-text';

            var name = document.createElement('div');
            name.className = 'playlist-name';
            name.textContent = pl.name;

            var url = document.createElement('div');
            url.className = 'playlist-url';
            url.textContent = pl.url;

            textWrap.appendChild(name);
            textWrap.appendChild(url);
            main.appendChild(textWrap);
            main.addEventListener('click', function () { toggleActivePlaylist(pl); });

            var editBtn = document.createElement('button');
            editBtn.className = 'playlist-action-btn';
            editBtn.tabIndex = -1;
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', function () { openAddPlaylistScreen(pl); });

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'playlist-action-btn delete';
            deleteBtn.tabIndex = -1;
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', function () { removePlaylist(pl); });

            wrapper.appendChild(main);
            wrapper.appendChild(editBtn);
            wrapper.appendChild(deleteBtn);
            list.appendChild(wrapper);
        });

        var addRow = document.createElement('button');
        addRow.className = 'playlist-row add-row';
        addRow.tabIndex = -1;
        addRow.textContent = '+ Add New Playlist';
        addRow.addEventListener('click', function () { openAddPlaylistScreen(null); });
        list.appendChild(addRow);

        PRESET_PLAYLISTS.forEach(function (preset) {
            if (state.playlists.some(function (p) { return p.url === preset.url; })) return;
            var presetRow = document.createElement('button');
            presetRow.className = 'playlist-row add-row';
            presetRow.tabIndex = -1;
            presetRow.textContent = '+ Add ' + preset.name;
            presetRow.addEventListener('click', function () { addPresetPlaylist(preset); });
            list.appendChild(presetRow);
        });

        var tuningRow = document.createElement('button');
        tuningRow.className = 'playlist-row add-row option-row';
        tuningRow.tabIndex = -1;
        tuningRow.textContent = 'Picture tuning (start at best quality, keep picture shape): ' + (pictureTuning ? 'On' : 'Off');
        tuningRow.addEventListener('click', function () {
            pictureTuning = !pictureTuning;
            try { localStorage.setItem(PICTURE_TUNING_KEY, pictureTuning ? '1' : '0'); } catch (e) { /* non-fatal */ }
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
            showToast(pictureTuning ? 'Picture tuning on. If the picture goes black, turn it off' : 'Picture tuning off');
        });
        list.appendChild(tuningRow);

        var reopenRow = document.createElement('button');
        reopenRow.className = 'playlist-row add-row option-row second';
        reopenRow.tabIndex = -1;
        reopenRow.textContent = 'Open the last channel when the app starts: ' + (reopenLast ? 'On' : 'Off');
        reopenRow.addEventListener('click', function () {
            reopenLast = !reopenLast;
            try { localStorage.setItem(REOPEN_LAST_KEY, reopenLast ? '1' : '0'); } catch (e) { /* non-fatal */ }
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
        });
        list.appendChild(reopenRow);

        if (updatesPossible()) {
            var updateRow = document.createElement('button');
            updateRow.className = 'playlist-row add-row option-row second';
            updateRow.tabIndex = -1;
            updateRow.textContent = 'Automatic updates from GitHub: ' + (autoUpdate ? 'On' : 'Off');
            updateRow.addEventListener('click', function () {
                autoUpdate = !autoUpdate;
                try {
                    localStorage.setItem(AUTO_UPDATE_KEY, autoUpdate ? '1' : '0');
                    // Off also drops a downloaded update: the next start uses the package's own version.
                    if (!autoUpdate) { localStorage.removeItem(UPDATE_KEY); updateReady = ''; }
                } catch (e) { /* non-fatal */ }
                renderPlaylistList();
                renderAppVersion();
                Focus.setZone('playlistList', Focus.row, 0);
                if (autoUpdate) checkForUpdate();
                else showToast('Automatic updates off. The built-in version ' + window.MYTVAPP_BUNDLED + ' runs from the next start');
            });
            list.appendChild(updateRow);
        }

        // Diagnostics log (a row so that Down scrolls it into view). OK refreshes it.
        var logRow = document.createElement('button');
        logRow.className = 'playlist-row add-row log-row';
        logRow.tabIndex = -1;
        logRow.textContent = 'Diagnostics (newest last)\n' + (readLog().join('\n') || 'nothing recorded yet');
        logRow.addEventListener('click', function () {
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
        });
        list.appendChild(logRow);
    }

    // Which copy is running: loaded from GitHub by the launcher, the bundled
    // copy in the installed package, or a TizenBrew module.
    function renderAppVersion() {
        var source = window.MYTVAPP_SOURCE;
        if (!source) {
            try { source = sessionStorage.getItem('mytvapp_source'); } catch (e) { source = null; }
        }
        if (!source) source = location.protocol.indexOf('http') === 0 ? 'web / TizenBrew module' : 'installed package';
        var player = hasAvplay ? 'Samsung player available' : 'Samsung player not available';
        var update = updateReady ? ' \u00b7 update ' + updateReady + ' ready: restart the app' : '';
        document.getElementById('appVersion').textContent = 'MyTvApp ' + APP_VERSION + ' \u00b7 running from ' + source + ' \u00b7 ' + player + update;
    }

    // ==========================================================================
    // Self-update. The installed package always starts from its own files
    // (js/boot.js). This part runs afterwards, in the background: if GitHub
    // has a newer version, its three files are downloaded as text and stored.
    // js/boot.js starts the stored copy on the next start and throws it away
    // if it does not start. Nothing here can stop the running app.
    // (lib/hls.min.js is not updated this way; it changes only with a new package.)
    // ==========================================================================
    function versionNewer(a, b) {
        var x = String(a).split('.'), y = String(b).split('.');
        for (var i = 0; i < 3; i++) {
            var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0;
            if (p !== q) return p > q;
        }
        return false;
    }

    // Only the installed app updates itself, and only a package that has
    // js/boot.js to start the download. localhost is allowed for testing.
    function updatesPossible() {
        return !!window.MYTVAPP_BUNDLED && (location.protocol.indexOf('http') !== 0 || location.hostname === 'localhost');
    }

    function fetchUpdateText(url) {
        return fetchWithTimeout(url).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        });
    }

    function checkForUpdate() {
        if (!autoUpdate || !updatesPossible()) return;
        var base = UPDATE_URL;
        try { base = localStorage.getItem(UPDATE_URL_KEY) || UPDATE_URL; } catch (e) { base = UPDATE_URL; }
        var version = '';

        fetchUpdateText(base + 'package.json?t=' + Date.now()).then(function (text) {
            version = String(JSON.parse(text).version || '');
            if (!versionNewer(version, APP_VERSION)) {
                logEvent('update check: ' + APP_VERSION + ' is current');
                return null;
            }
            var bad = null;
            try { bad = localStorage.getItem(UPDATE_BAD_KEY); } catch (e) { bad = null; }
            if (bad === version) {
                logEvent('update ' + version + ' skipped: it failed to start before');
                return null;
            }
            var v = '?v=' + encodeURIComponent(version);
            return Promise.all([
                fetchUpdateText(base + 'index.html' + v),
                fetchUpdateText(base + 'css/style.css' + v),
                fetchUpdateText(base + 'js/main.js' + v)
            ]);
        }).then(function (files) {
            if (!files) return;
            var js = files[2];
            // The three files must belong together and be the real thing.
            if (js.indexOf("APP_VERSION = '" + version + "'") === -1 || js.indexOf('MYTVAPP_STARTED') === -1) {
                throw new Error('script is not version ' + version);
            }
            var doc = new DOMParser().parseFromString(files[0], 'text/html');
            var app = doc && doc.getElementById('app');
            if (!app) throw new Error('page has no app markup');
            localStorage.setItem(UPDATE_KEY, JSON.stringify({ version: version, js: js, css: files[1], html: app.innerHTML }));
            // This app is clearly running: a start-up check still open from this
            // start (js/boot.js) must not be held against the new download.
            localStorage.removeItem('mytvapp_update_pending');
            updateReady = version;
            logEvent('update ' + version + ' downloaded');
            applyUpdateOrAnnounce(version);
        }).catch(function (err) {
            logEvent('update check failed: ' + ((err && err.message) || err));
        });
    }

    // Right after the start, with nobody in the middle of something, restart
    // into the update at once. Otherwise it waits for the next start.
    function applyUpdateOrAnnounce(version) {
        var idle = activeScreenId() !== 'screen-player' && activeScreenId() !== 'screen-add' &&
            document.getElementById('confirmModal').hidden && !state.nowPlaying;
        if (idle && Date.now() - bootTime < UPDATE_RESTART_WINDOW_MS) {
            showToast('Updating to ' + version + '\u2026');
            setTimeout(function () { location.reload(); }, 1500);
        } else {
            showToast('Update ' + version + ' is ready: restart the app to use it');
            if (activeScreenId() === 'screen-settings') renderAppVersion();
        }
    }

    Focus.zones.playlistList = {
        getMatrix: function () {
            var wrappers = document.querySelectorAll('.playlist-row-wrapper');
            var rows = Array.prototype.map.call(wrappers, function (w) {
                return Array.prototype.slice.call(w.querySelectorAll('button'));
            });
            var otherRows = document.querySelectorAll('.playlist-row.add-row');
            Array.prototype.forEach.call(otherRows, function (btn) { rows.push([btn]); });
            return rows;
        }
    };
    leftEdgeToRail('playlistList');

    function toggleActivePlaylist(pl) {
        var idx = state.activePlaylistIds.indexOf(pl.id);
        if (idx === -1) {
            state.activePlaylistIds.push(pl.id);
            saveActivePlaylistIds();
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, Focus.col);
            loadChannelsForPlaylist(pl).then(function (err) {
                if (err) showToast('Could not load "' + pl.name + '": ' + err.message);
            });
        } else {
            state.activePlaylistIds.splice(idx, 1);
            saveActivePlaylistIds();
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, Focus.col);
            removeChannelsForPlaylist(pl.id);
        }
    }

    function addPresetPlaylist(preset) {
        var newPl = { id: 'pl_' + Date.now(), name: preset.name, url: preset.url };
        state.playlists.push(newPl);
        state.activePlaylistIds.push(newPl.id);
        savePlaylists();
        saveActivePlaylistIds();
        switchToScreen('screen-settings');
        showToast('Playlist added');
        loadChannelsForPlaylist(newPl).then(function (err) {
            if (err) showToast('Could not load "' + newPl.name + '": ' + err.message);
        });
    }

    function removePlaylist(pl) {
        showConfirm('Remove "' + pl.name + '"?', 'Delete', function () {
            state.playlists = state.playlists.filter(function (p) { return p.id !== pl.id; });
            state.activePlaylistIds = state.activePlaylistIds.filter(function (id) { return id !== pl.id; });
            savePlaylists();
            saveActivePlaylistIds();

            // Favorited channels sourced from the deleted playlist no longer exist.
            var hadFavorites = state.favorites.some(function (f) { return f.playlistId === pl.id; });
            if (hadFavorites) {
                state.favorites = state.favorites.filter(function (f) { return f.playlistId !== pl.id; });
                saveFavorites();
            }

            removeChannelsForPlaylist(pl.id);
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
            showToast('Playlist removed');
        });
    }

    // ==========================================================================
    // Add / Edit Playlist screen (native text field + Samsung system keyboard)
    // ==========================================================================
    var urlInput = document.getElementById('urlInput');

    function openAddPlaylistScreen(playlist) {
        editingPlaylistId = playlist ? playlist.id : null;
        urlInput.value = playlist ? playlist.url : 'https://';
        document.getElementById('addPlaylistTitle').textContent = playlist ? 'Edit Playlist' : 'Add M3U Playlist';
        showScreen('screen-add');
        Focus.setZone('urlField', 0, 0);
    }

    // Focusing a real <input> opens Samsung's system keyboard (IME). That
    // system keyboard is also what the SmartThings phone app types into.
    function openUrlKeyboard() {
        urlInput.focus();
        try { urlInput.setSelectionRange(urlInput.value.length, urlInput.value.length); } catch (e) { /* type=url may not support it */ }
    }

    function closeUrlKeyboard(moveToSave) {
        urlInput.blur();
        if (moveToSave) Focus.setZone('addActions', 0, 0);
        else Focus.setZone('urlField', 0, 0);
    }

    urlInput.addEventListener('click', openUrlKeyboard);

    function submitPlaylistUrl() {
        var url = urlInput.value.trim();
        if (!/^https?:\/\/\S+\.\S+/i.test(url)) { showToast('Enter a valid playlist URL first'); return; }

        if (editingPlaylistId) {
            var pl = state.playlists.find(function (p) { return p.id === editingPlaylistId; });
            if (!pl) return;
            pl.url = url;
            pl.name = deriveNameFromUrl(url);
            savePlaylists();
            switchToScreen('screen-settings');
            showToast('Playlist updated');
            if (state.activePlaylistIds.indexOf(pl.id) !== -1) {
                loadChannelsForPlaylist(pl).then(function (err) {
                    if (err) showToast('Could not load "' + pl.name + '": ' + err.message);
                });
            }
        } else {
            var newPl = { id: 'pl_' + Date.now(), name: deriveNameFromUrl(url), url: url };
            state.playlists.push(newPl);
            state.activePlaylistIds.push(newPl.id);
            savePlaylists();
            saveActivePlaylistIds();
            switchToScreen('screen-settings');
            showToast('Playlist added');
            loadChannelsForPlaylist(newPl).then(function (err) {
                if (err) showToast('Could not load "' + newPl.name + '": ' + err.message);
            });
        }
    }

    Focus.zones.urlField = {
        getMatrix: function () { return [[urlInput]]; },
        onEdge: function (dir) { if (dir === 'down') Focus.setZone('addActions', 0, 0); }
    };
    Focus.zones.addActions = {
        getMatrix: function () { return [Array.prototype.slice.call(document.querySelectorAll('.add-actions .btn'))]; },
        onEdge: function (dir) { if (dir === 'up') Focus.setZone('urlField', 0, 0); }
    };

    document.getElementById('loadPlaylistBtn').addEventListener('click', submitPlaylistUrl);
    document.getElementById('cancelAddBtn').addEventListener('click', function () {
        switchToScreen(editingPlaylistId ? 'screen-settings' : 'screen-grid');
    });

    // ==========================================================================
    // Player screen — fullscreen, favorite toggled via a real focusable button
    // (long-press proved unreliable on this remote/WebKit combination).
    // ==========================================================================
    function playChannel(ch, context, list) {
        var current = state.nowPlaying || state.lastExited;
        if (current && current.url !== ch.url) {
            state.prevChannel = { ch: current, context: state.zapContext, list: state.zapList };
        }
        state.lastExited = null;
        var from = activeScreenId();
        if (from !== 'screen-player') {
            state.returnTo = { screen: from, zone: Focus.currentZone, row: Focus.row, col: Focus.col, categoryIndex: state.activeCategoryIndex };
        }
        state.nowPlaying = ch;
        state.zapContext = context;
        state.zapList = list || (context === 'favorites' ? visibleFavorites() : (state.categories[state.activeCategoryIndex] || { channels: [] }).channels);
        saveLastChannel(ch, context);
        closeChannelPanel();
        endInfoInteractive();
        showScreen('screen-player');
        startPlayback();
    }

    function playPrevious() {
        var p = state.prevChannel;
        if (!p) { showToast('No previous channel yet'); return; }
        playChannel(p.ch, p.context, p.list);
    }

    function saveLastChannel(ch, context) {
        try {
            localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({
                url: ch.url, name: ch.name, group: ch.group, playlistId: ch.playlistId, context: context
            }));
        } catch (e) { /* non-fatal */ }
    }

    // Startup: reopen the last watched channel if its playlist loaded.
    function reopenLastChannel() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) || 'null'); } catch (e) { saved = null; }
        if (!saved || !saved.url || !reopenLast) return;
        // The previous start reopened a channel and never got as far as a
        // picture or a key press: do not walk into the same problem again.
        var pending = null;
        try { pending = localStorage.getItem(REOPEN_PENDING_KEY); } catch (e) { pending = null; }
        if (pending === '1') {
            clearReopenPending();
            logEvent('last channel not reopened: it did not start last time');
            showToast('Last channel not reopened: it did not start last time');
            return;
        }
        try { localStorage.setItem(REOPEN_PENDING_KEY, '1'); } catch (e) { /* non-fatal */ }
        if (saved.context === 'favorites') {
            var favs = visibleFavorites();
            var fav = favs.find(function (f) { return f.url === saved.url; });
            if (fav) { playChannel(fav, 'favorites', favs); return; }
        }
        for (var i = 0; i < state.categories.length; i++) {
            var cat = state.categories[i];
            if (cat.playlistId !== saved.playlistId || cat.name !== saved.group) continue;
            var ch = cat.channels.find(function (c) { return c.url === saved.url; });
            if (ch) { state.activeCategoryIndex = i; playChannel(ch, 'category', cat.channels); return; }
        }
    }

    function clearReopenPending() {
        try { localStorage.removeItem(REOPEN_PENDING_KEY); } catch (e) { /* non-fatal */ }
    }

    function zapChannel(delta) {
        var list = state.zapList;
        if (!list || !list.length) return;
        var idx = list.findIndex(function (c) { return c.url === state.nowPlaying.url; });
        if (idx === -1) idx = 0;
        idx = (idx + delta + list.length) % list.length;
        playChannel(list[idx], state.zapContext, list);
    }

    // Playback strategy: on a Samsung TV, use the TV's built-in player first
    // (plain <video src>). It decodes HLS natively and is not subject to the
    // cross-origin (CORS) rules that hls.js's network requests are, which is
    // why other TV players can play streams that hls.js cannot. hls.js is the
    // second engine; off-TV (browser testing) the order is reversed. If an
    // engine errors or shows no video within PLAY_WATCHDOG_MS, the next one is tried.
    var PLAY_WATCHDOG_MS = 12000;
    var isTizen = !!(window.tizen);
    // Samsung's native player (AVPlay). Present only in an installed .wgt with
    // webapis.js loaded; not in a TizenBrew module or a desktop browser. It
    // fetches streams itself (no CORS) and decodes HLS natively, like other
    // Samsung IPTV apps, so it is the first choice whenever it exists.
    var hasAvplay = !!(window.webapis && window.webapis.avplay);
    var avplayObject = null;

    function setPlayerStatus(msg) {
        document.getElementById('playerStatus').textContent = msg;
    }

    function stopEngines() {
        if (state.watchdogId) { clearTimeout(state.watchdogId); state.watchdogId = null; }
        var hadHls = !!state.hls;
        if (state.hls) { state.hls.destroy(); state.hls = null; }
        if (state.avplayOpen) {
            try { webapis.avplay.stop(); } catch (e) { /* already stopped */ }
            try { webapis.avplay.close(); } catch (e) { /* already closed */ }
            state.avplayOpen = false;
        }
        document.documentElement.classList.remove('avplay-active');
        // Reset the <video> element only if it was in use.
        if (hadHls || videoPlayer.hasAttribute('src')) {
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
        }
    }

    function startPlayback() {
        var ch = state.nowPlaying;
        if (!ch) return;

        // tryNextEngine() below stops whatever was playing.
        state.playToken = (state.playToken || 0) + 1;
        state.isPlaying = false;
        state.quality = '';

        document.getElementById('nowPlayingName').textContent = ch.name;
        document.getElementById('nowPlayingNumber').textContent = ch.number ? String(ch.number) : '';
        document.getElementById('nowPlayingGroup').textContent = ch.group || '';
        var logoEl = document.getElementById('nowPlayingLogo');
        logoEl.style.backgroundImage = ch.logo ? ('url(' + JSON.stringify(ch.logo) + ')') : '';
        updateFavoriteButton();

        var hlsOk = !!(window.Hls && Hls.isSupported());
        var engines = hasAvplay ? ['avplay', 'native', 'hls'] : (isTizen ? ['native', 'hls'] : ['hls', 'native']);
        state.enginesLeft = engines.filter(function (e) { return e !== 'hls' || hlsOk; });
        state.playErrors = [];
        state.playFailed = false;
        showOverlay();
        tryNextEngine(state.playToken);
    }

    function tryNextEngine(token) {
        if (token !== state.playToken) return;
        var ch = state.nowPlaying;
        var engine = state.enginesLeft.shift();
        stopEngines();
        if (!engine) {
            state.playFailed = true;
            logEvent('could not play: ' + (state.playErrors.join(' | ') || 'no player available'));
            setPlayerStatus('Could not play \u2014 ' + (state.playErrors.join(' | ') || 'no player available'));
            showToast('This channel is unavailable right now');
            return;
        }
        state.engine = engine;
        logEvent('play "' + ch.name + '" with ' + engineLabel(engine));
        state.watchdogId = setTimeout(function () {
            if (token !== state.playToken || state.isPlaying) return;
            engineFailed(token, engineLabel(engine) + ': no video after ' + (PLAY_WATCHDOG_MS / 1000) + ' s');
        }, PLAY_WATCHDOG_MS);

        if (engine === 'avplay') startAvplay(ch, token);
        else if (engine === 'native') startNative(ch, token);
        else startHls(ch, token);
    }

    function engineLabel(engine) {
        return engine === 'avplay' ? 'Samsung player' : (engine === 'native' ? 'TV player' : 'hls.js');
    }

    function markPlaying() {
        if (!state.nowPlaying || state.isPlaying) return;
        state.isPlaying = true;
        if (state.watchdogId) { clearTimeout(state.watchdogId); state.watchdogId = null; }
        logEvent('playing (' + engineLabel(state.engine) + ')');
        setPlayerStatus(playingText());
        showOverlay();
        // Browser players: read the picture size shortly after the start.
        // The Samsung player is only asked when Right/INFO is pressed.
        if (state.engine !== 'avplay') scheduleQualityRefresh(1500);
    }

    // "Playing (Samsung player) · 1920x1080 · 4.8 Mbps" so a soft picture can
    // be told apart: low numbers mean the channel itself sends low quality.
    // Uses the quality last read by refreshQuality(). It must not ask the
    // player itself: this runs inside the Samsung player's own callbacks, and
    // calling back into the player from there can freeze it on some TVs.
    function playingText() {
        var text = 'Playing (' + engineLabel(state.engine) + ')';
        return state.quality ? text + ' \u00b7 ' + state.quality : text;
    }

    function scheduleQualityRefresh(delayMs) {
        var token = state.playToken;
        setTimeout(function () {
            if (token !== state.playToken || !state.isPlaying) return;
            if (state.engine === 'avplay') logEvent('asking Samsung player for picture info');
            state.quality = currentQuality();
            if (state.engine === 'avplay') logEvent('picture info: ' + (state.quality || 'none'));
            setPlayerStatus(playingText());
        }, delayMs);
    }

    function currentQuality() {
        var w = 0, h = 0, kbps = 0;
        try {
            if (state.engine === 'avplay' && state.avplayOpen) {
                var tracks = webapis.avplay.getCurrentStreamInfo() || [];
                for (var i = 0; i < tracks.length; i++) {
                    if (tracks[i].type !== 'VIDEO') continue;
                    var info = JSON.parse(tracks[i].extra_info || '{}');
                    w = parseInt(info.Width || info.width, 10) || 0;
                    h = parseInt(info.Height || info.height, 10) || 0;
                    kbps = Math.round((parseInt(info.Bit_rate || info.bitrate, 10) || 0) / 1000);
                }
            } else if (state.engine === 'hls' && state.hls && state.hls.levels && state.hls.currentLevel >= 0) {
                var lvl = state.hls.levels[state.hls.currentLevel];
                w = lvl.width; h = lvl.height; kbps = Math.round((lvl.bitrate || 0) / 1000);
            } else {
                w = videoPlayer.videoWidth; h = videoPlayer.videoHeight;
            }
        } catch (e) { /* quality info not available */ }
        var parts = [];
        if (w && h) parts.push(w + 'x' + h);
        if (kbps) parts.push((kbps / 1000).toFixed(1) + ' Mbps');
        return parts.join(' \u00b7 ');
    }

    function streamStopped(reason) {
        stopEngines();
        state.isPlaying = false;
        logEvent('stream stopped: ' + reason);
        setPlayerStatus('Stream stopped: ' + reason);
        showOverlay();
        showToast('This channel is unavailable right now');
    }

    function startAvplay(ch, token) {
        setPlayerStatus('Connecting (Samsung player)\u2026');
        if (!avplayObject) {
            avplayObject = document.createElement('object');
            avplayObject.id = 'avPlayer';
            avplayObject.type = 'application/avplayer';
            var screen = document.getElementById('screen-player');
            screen.insertBefore(avplayObject, screen.firstChild);
        }
        document.documentElement.classList.add('avplay-active');
        var av = webapis.avplay;
        var label = 'Samsung player: ';
        try {
            av.open(ch.url);
            state.avplayOpen = true;
            // setDisplayRect always uses a 1920x1080 base (Samsung AVPlay guide): full screen.
            av.setDisplayRect(0, 0, 1920, 1080);
            // Picture tuning (optional): adaptive streams start at the highest
            // quality the stream offers instead of the TV's default.
            if (pictureTuning) {
                try { av.setStreamingProperty('ADAPTIVE_INFO', 'STARTBITRATE=HIGHEST'); } catch (e) { /* single-quality stream */ }
            }
            av.setListener({
                onbufferingstart: function () {
                    if (token === state.playToken && state.isPlaying) setPlayerStatus('Buffering\u2026 (Samsung player)');
                },
                onbufferingcomplete: function () {
                    if (token === state.playToken && state.isPlaying) setPlayerStatus(playingText());
                },
                oncurrentplaytime: function () {
                    if (token === state.playToken) markPlaying();
                },
                onstreamcompleted: function () {
                    if (token === state.playToken) streamStopped('stream ended');
                },
                onerror: function (err) {
                    if (token !== state.playToken) return;
                    var reason = label + (err && err.name ? err.name : String(err));
                    if (state.isPlaying) streamStopped(reason); else engineFailed(token, reason);
                },
                onevent: function () { /* not used */ }
            });
            av.prepareAsync(function () {
                if (token !== state.playToken) return;
                // Picture tuning (optional): keep the stream's own shape instead
                // of stretching it. Set once the stream is prepared, as in
                // Samsung's samples.
                if (pictureTuning) {
                    try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'); } catch (e) { /* older firmware */ }
                }
                try { av.play(); } catch (e) { engineFailed(token, label + (e.name || e)); }
            }, function (e) {
                if (token === state.playToken) engineFailed(token, label + (e && e.name ? e.name : String(e)));
            });
        } catch (e) {
            engineFailed(token, label + (e && e.name ? e.name : String(e)));
        }
    }

    function engineFailed(token, reason) {
        if (token !== state.playToken || state.isPlaying) return;
        console.error('Playback engine failed:', reason);
        logEvent('failed: ' + reason);
        state.playErrors.push(reason);
        if (state.enginesLeft.length) setPlayerStatus(reason + ' — trying ' + engineLabel(state.enginesLeft[0]) + '…');
        tryNextEngine(token);
    }

    function safePlay(token) {
        var p = videoPlayer.play();
        if (p && p.catch) p.catch(function (e) {
            if (token === state.playToken && !state.isPlaying && !state.playFailed) setPlayerStatus(engineLabel(state.engine) + ': play() refused (' + (e && e.name || 'error') + ')');
        });
    }

    function startNative(ch, token) {
        setPlayerStatus('Connecting (TV player)…');
        videoPlayer.src = ch.url;
        videoPlayer.load();
        safePlay(token);
    }

    function startHls(ch, token) {
        setPlayerStatus('Connecting (hls.js)…');
        // Local reference: callbacks from an earlier attempt must not act on a newer one.
        var hls = new Hls({ backBufferLength: 30 });
        var networkRetries = 0;
        var mediaRecoveries = 0;
        state.hls = hls;
        hls.loadSource(ch.url);
        hls.attachMedia(videoPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (state.hls !== hls) return;
            setPlayerStatus('Stream found (hls.js), starting video…');
            safePlay(token);
        });
        // A segment arriving means the stream is healthy again.
        hls.on(Hls.Events.FRAG_LOADED, function () { networkRetries = 0; });
        hls.on(Hls.Events.ERROR, function (event, data) {
            if (state.hls !== hls) return;
            if (!data.fatal) {
                if (!state.isPlaying) setPlayerStatus('hls.js warning: ' + data.details);
                return;
            }
            console.error('HLS.js fatal error:', data.type, data.details);
            // A fatal manifest error means hls.js already retried the playlist
            // itself; startLoad() would not re-request it.
            var manifestFailed = data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
                data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !manifestFailed && networkRetries < MAX_NETWORK_RETRIES) {
                networkRetries++;
                setTimeout(function () { if (state.hls === hls) hls.startLoad(); }, 1000 * Math.pow(2, networkRetries - 1));
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < MAX_MEDIA_RECOVERIES) {
                mediaRecoveries++;
                if (mediaRecoveries === 2) hls.swapAudioCodec();
                hls.recoverMediaError();
            } else if (state.isPlaying) {
                // Stream died mid-playback: tell the user instead of freezing.
                stopEngines();
                state.isPlaying = false;
                setPlayerStatus('Stream stopped: ' + data.details);
                showOverlay();
                showToast('This channel is unavailable right now');
            } else {
                engineFailed(token, 'hls.js: ' + data.details);
            }
        });
    }

    // Shared <video> events for both engines.
    videoPlayer.addEventListener('playing', function () {
        if (state.engine === 'avplay') return;
        // Also clears a "Buffering…" status once the picture is moving again.
        if (state.isPlaying) setPlayerStatus(playingText()); else markPlaying();
    });
    videoPlayer.addEventListener('error', function () {
        if (!state.nowPlaying || !videoPlayer.getAttribute('src') && !state.hls) return;
        if (state.engine !== 'native') return; // hls.js reports its own errors
        var err = videoPlayer.error;
        var codes = { 1: 'aborted', 2: 'network error', 3: 'decode error', 4: 'format not supported' };
        var reason = 'TV player: ' + (err ? (codes[err.code] || ('code ' + err.code)) : 'error');
        if (state.isPlaying) {
            stopEngines();
            state.isPlaying = false;
            setPlayerStatus('Stream stopped: ' + reason);
            showOverlay();
            showToast('This channel is unavailable right now');
        } else {
            engineFailed(state.playToken, reason);
        }
    });
    videoPlayer.addEventListener('waiting', function () {
        if (state.isPlaying) setPlayerStatus('Buffering… (' + engineLabel(state.engine) + ')');
    });

    function updateFavoriteButton() {
        var btn = document.getElementById('favoriteBtn');
        var icon = document.getElementById('favoriteIcon');
        if (!state.nowPlaying) return;
        var fav = isFavorited(state.nowPlaying);
        icon.textContent = fav ? '\u2605' : '\u2606';
        btn.classList.toggle('active', fav);
    }

    document.getElementById('favoriteBtn').addEventListener('click', function () {
        toggleFavorite(state.nowPlaying);
    });

    Focus.zones.playerFavorite = {
        getMatrix: function () { return [[document.getElementById('favoriteBtn')]]; }
    };

    function showOverlay() {
        var overlay = document.getElementById('playerOverlay');
        overlay.classList.add('visible');
        if (state.overlayTimeoutId) clearTimeout(state.overlayTimeoutId);
        state.overlayTimeoutId = setTimeout(hideOverlayIfPlaying, OVERLAY_HIDE_MS);
    }

    // The overlay (with the status line) stays up until video is actually playing.
    function hideOverlayIfPlaying() {
        if (!state.isPlaying) return;
        document.getElementById('playerOverlay').classList.remove('visible');
        endInfoInteractive();
    }

    // Right / Info: show the overlay with the Favorite button focused, so OK
    // toggles the favorite. Otherwise OK opens the channel list.
    function startInfoInteractive() {
        state.infoInteractive = true;
        if (state.isPlaying) { setPlayerStatus(playingText()); scheduleQualityRefresh(0); }
        showOverlay();
        Focus.setZone('playerFavorite', 0, 0);
    }

    function endInfoInteractive() {
        state.infoInteractive = false;
        var btn = document.getElementById('favoriteBtn');
        if (btn) btn.classList.remove('focused');
    }

    // ==========================================================================
    // Channel-list panel (over the video). Only PANEL_ROWS rows are rendered at
    // a time, so a 2,000-channel category stays light.
    // ==========================================================================
    function openChannelPanel() {
        var list = state.zapList || [];
        if (!list.length) { showToast('No channel list for this channel'); return; }
        var idx = state.nowPlaying ? list.findIndex(function (c) { return c.url === state.nowPlaying.url; }) : 0;
        state.panelIndex = idx < 0 ? 0 : idx;
        state.panelOpen = true;
        endInfoInteractive();
        var cat = state.categories[state.activeCategoryIndex];
        document.getElementById('channelPanelTitle').textContent =
            state.zapContext === 'favorites' ? 'Favorites' : (cat ? cat.name : 'Channels');
        document.getElementById('channelPanel').hidden = false;
        renderChannelPanel();
    }

    function closeChannelPanel() {
        state.panelOpen = false;
        var panel = document.getElementById('channelPanel');
        if (panel) panel.hidden = true;
    }

    function renderChannelPanel() {
        var list = state.zapList;
        var box = document.getElementById('channelPanelList');
        box.innerHTML = '';
        var start = Math.max(0, Math.min(state.panelIndex - Math.floor(PANEL_ROWS / 2), list.length - PANEL_ROWS));
        var end = Math.min(list.length, start + PANEL_ROWS);
        var frag = document.createDocumentFragment();
        for (var i = start; i < end; i++) {
            var ch = list[i];
            var row = document.createElement('div');
            row.className = 'panel-row' + (i === state.panelIndex ? ' focused' : '');
            var num = document.createElement('span');
            num.className = 'panel-num';
            num.textContent = ch.number ? String(ch.number) : '';
            var logo = document.createElement('span');
            logo.className = 'panel-logo';
            if (ch.logo) logo.style.backgroundImage = 'url(' + JSON.stringify(ch.logo) + ')';
            var name = document.createElement('span');
            name.className = 'panel-name';
            name.textContent = ch.name;
            row.appendChild(num);
            row.appendChild(logo);
            row.appendChild(name);
            if (state.nowPlaying && ch.url === state.nowPlaying.url) {
                var playing = document.createElement('span');
                playing.className = 'panel-playing';
                playing.textContent = 'PLAYING';
                row.appendChild(playing);
            }
            frag.appendChild(row);
        }
        box.appendChild(frag);
    }

    function moveChannelPanel(delta) {
        var n = state.zapList.length;
        if (!n) return;
        if (Math.abs(delta) === 1) state.panelIndex = (state.panelIndex + delta + n) % n;
        else state.panelIndex = Math.max(0, Math.min(n - 1, state.panelIndex + delta));
        renderChannelPanel();
    }

    // ==========================================================================
    // Number zapping: digits collect for NUMBER_ENTRY_MS, then jump. The
    // current list is searched first, then every loaded channel.
    // ==========================================================================
    function addDigit(d) {
        if (state.digitBuffer.length >= 4) return;
        state.digitBuffer += d;
        var box = document.getElementById('numberEntry');
        box.textContent = state.digitBuffer;
        box.hidden = false;
        if (state.digitTimer) clearTimeout(state.digitTimer);
        state.digitTimer = setTimeout(commitDigits, NUMBER_ENTRY_MS);
    }

    function commitDigits() {
        if (state.digitTimer) { clearTimeout(state.digitTimer); state.digitTimer = null; }
        var n = parseInt(state.digitBuffer, 10);
        state.digitBuffer = '';
        document.getElementById('numberEntry').hidden = true;
        if (!n) return;
        var list = state.zapList || [];
        var ch = list.find(function (c) { return c.number === n; });
        if (ch) { playChannel(ch, state.zapContext, list); return; }
        for (var i = 0; i < state.categories.length; i++) {
            var found = state.categories[i].channels.find(function (c) { return c.number === n; });
            if (found) { state.activeCategoryIndex = i; playChannel(found, 'category', state.categories[i].channels); return; }
        }
        showToast('No channel ' + n);
    }

    function handlePlayerKey(code) {
        if (state.panelOpen) {
            switch (code) {
                case KEYCODE.UP: moveChannelPanel(-1); break;
                case KEYCODE.DOWN: moveChannelPanel(1); break;
                case KEYCODE.CH_UP: moveChannelPanel(-PANEL_ROWS); break;
                case KEYCODE.CH_DOWN: moveChannelPanel(PANEL_ROWS); break;
                case KEYCODE.ENTER: playChannel(state.zapList[state.panelIndex], state.zapContext, state.zapList); break;
                case KEYCODE.BACK: case KEYCODE.LEFT: case KEYCODE.CH_LIST: closeChannelPanel(); break;
            }
            return;
        }
        if (code >= 48 && code <= 57) { addDigit(String(code - 48)); return; }
        if (code >= 96 && code <= 105) { addDigit(String(code - 96)); return; }
        if (state.digitBuffer && code === KEYCODE.ENTER) { commitDigits(); return; }
        switch (code) {
            case KEYCODE.ENTER:
                if (state.infoInteractive) Focus.select(); else openChannelPanel();
                break;
            case KEYCODE.UP: case KEYCODE.CH_UP: zapChannel(1); break;
            case KEYCODE.DOWN: case KEYCODE.CH_DOWN: zapChannel(-1); break;
            case KEYCODE.LEFT: case KEYCODE.PREV_CH: playPrevious(); break;
            case KEYCODE.RIGHT: case KEYCODE.INFO: startInfoInteractive(); break;
            case KEYCODE.CH_LIST: openChannelPanel(); break;
            case KEYCODE.MEDIA_PLAY_PAUSE: togglePlayPause(); break;
            case KEYCODE.BACK:
                if (state.infoInteractive) { endInfoInteractive(); document.getElementById('playerOverlay').classList.remove('visible'); }
                else exitPlayerToGrid();
                break;
        }
    }

    function togglePlayPause() {
        if (state.engine === 'avplay' && state.avplayOpen) {
            try {
                if (webapis.avplay.getState() === 'PLAYING') webapis.avplay.pause(); else webapis.avplay.play();
            } catch (e) { /* ignore */ }
        } else if (videoPlayer.paused) videoPlayer.play(); else videoPlayer.pause();
        showOverlay();
    }

    function exitPlayerToGrid() {
        state.playToken = (state.playToken || 0) + 1;
        stopEngines();
        state.isPlaying = false;
        state.lastExited = state.nowPlaying;
        state.nowPlaying = null;
        closeChannelPanel();
        endInfoInteractive();
        if (state.digitTimer) { clearTimeout(state.digitTimer); state.digitTimer = null; }
        state.digitBuffer = '';
        document.getElementById('numberEntry').hidden = true;

        // Go back to where the channel was opened from.
        var back = state.returnTo;
        state.returnTo = null;
        if (back && back.screen === 'screen-category-channels' && state.categories[state.activeCategoryIndex]) {
            if (back.categoryIndex === state.activeCategoryIndex && document.querySelector('#categoryChannelsGrid .channel-tile')) {
                showScreen('screen-category-channels');
                setNavActive('screen-category-channels');
                Focus.setZone('categoryChannelsGrid', back.row, back.col);
            } else {
                openCategoryChannels(state.activeCategoryIndex);
            }
        } else {
            switchToScreen('screen-grid');
        }
    }

    // The TV takes the video hardware away when the app goes to the background
    // (Home key, another app). Without this the picture stays black on return.
    document.addEventListener('visibilitychange', function () {
        if (!state.nowPlaying || activeScreenId() !== 'screen-player') return;
        logEvent(document.hidden ? 'app hidden' : 'app visible again');
        if (document.hidden) {
            state.playToken = (state.playToken || 0) + 1;
            stopEngines();
            state.isPlaying = false;
        } else {
            startPlayback();
        }
    });

    // ==========================================================================
    // Back handling
    // ==========================================================================
    function handleBack() {
        if (!document.getElementById('confirmModal').hidden) { hideConfirm(); return; }
        if (document.getElementById('screen-player').classList.contains('active')) { exitPlayerToGrid(); return; }
        if (document.getElementById('screen-category-channels').classList.contains('active')) { switchToScreen('screen-categories'); return; }
        if (document.getElementById('screen-add').classList.contains('active')) {
            switchToScreen(editingPlaylistId ? 'screen-settings' : 'screen-grid');
            return;
        }
        if (document.getElementById('screen-settings').classList.contains('active')) { switchToScreen('screen-grid'); return; }
        if (document.getElementById('screen-categories').classList.contains('active')) { switchToScreen('screen-grid'); return; }
        showConfirm('Are you sure you want to exit the app?', 'Exit', exitApp);
    }

    // Installed app: close it through the Tizen API. As a TizenBrew module the
    // page has no Tizen API, so go back to the TizenBrew screen that opened it.
    function exitApp() {
        stopEngines();
        if (window.tizen && tizen.application) {
            try { tizen.application.getCurrentApplication().exit(); return; } catch (e) { /* fall through */ }
        }
        if (window.history.length > 1) { window.history.back(); return; }
        try { window.close(); } catch (e) { /* nothing else to try */ }
        showToast('Press the Home button to leave the app');
    }

    // ==========================================================================
    // Global remote-control key handling — keyCode only. Samsung's own docs
    // and every real Tizen sample use keyCode; this platform's WebKit does not
    // reliably populate the modern event.key/event.repeat properties.
    // ==========================================================================
    var KEYCODE = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009,
        CH_UP: 427, CH_DOWN: 428, MEDIA_PLAY_PAUSE: 10252,
        PREV_CH: 10190, CH_LIST: 10073, INFO: 457
    };

    document.addEventListener('keydown', function (event) {
        // While the URL field has focus the system keyboard is open: let it
        // handle typing/arrows (no preventDefault), and only react to Done/Cancel.
        if (document.activeElement === urlInput) {
            if (event.keyCode === IME_DONE) closeUrlKeyboard(true);
            else if (event.keyCode === IME_CANCEL || event.keyCode === KEYCODE.BACK) closeUrlKeyboard(false);
            return;
        }

        // Navigation keys are handled here; stop the browser from also
        // scrolling the page or "clicking" with them.
        var kc = event.keyCode;
        if ((kc >= 37 && kc <= 40) || kc === KEYCODE.ENTER || kc === KEYCODE.BACK) event.preventDefault();

        var onPlayer = document.getElementById('screen-player').classList.contains('active');

        if (onPlayer) {
            clearReopenPending();
            var overlay = document.getElementById('playerOverlay');
            if (overlay.classList.contains('visible') && state.overlayTimeoutId) {
                clearTimeout(state.overlayTimeoutId);
                state.overlayTimeoutId = setTimeout(hideOverlayIfPlaying, OVERLAY_HIDE_MS);
            }
            handlePlayerKey(event.keyCode);
            return;
        }

        switch (event.keyCode) {
            case KEYCODE.UP: Focus.move('up'); break;
            case KEYCODE.DOWN: Focus.move('down'); break;
            case KEYCODE.LEFT: Focus.move('left'); break;
            case KEYCODE.RIGHT: Focus.move('right'); break;
            case KEYCODE.ENTER: Focus.select(); break;
            case KEYCODE.BACK: handleBack(); break;
        }
    });

    // ==========================================================================
    // Boot
    // ==========================================================================
    window.MYTVAPP_STARTED = true;
    var bootMsg = document.getElementById('bootMsg');
    if (bootMsg && bootMsg.parentNode) bootMsg.parentNode.removeChild(bootMsg);
    loadFavorites();
    loadPlaylistsFromStorage();
    logEvent('start ' + APP_VERSION + ' from ' + (window.MYTVAPP_SOURCE || (function () {
        try { return sessionStorage.getItem('mytvapp_source'); } catch (e) { return null; }
    })() || 'own page') + ', Samsung player ' + (hasAvplay ? 'yes' : 'no'));
    Focus.setZone('iconRail', 0, 0);

    // First run (or every playlist deleted): open the Playlists screen so the
    // one-press iptv-org presets are right there.
    refreshActiveChannels({ screen: state.playlists.length ? 'screen-grid' : 'screen-settings', after: reopenLastChannel });
    setTimeout(checkForUpdate, UPDATE_CHECK_DELAY_MS);
});

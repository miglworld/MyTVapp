// Runs as soon as it is loaded: this script is the last element of <body>, so
// the whole page already exists. It must not wait for DOMContentLoaded: when
// js/boot.js starts a downloaded copy of this script, that event is long past.
(function (main) {
    try { main(); } catch (e) {
        // A TV has no console to look at: put the error on the screen.
        var where = ((e && e.stack) || '').split('\n')[1] || '';
        if (window.MYTVAPP_ERROR) window.MYTVAPP_ERROR(((e && e.message) || String(e)) + ' ' + where.trim());
        if (window.console) console.error(e);
    }
})(function () {
    'use strict';

    // Under Node (scripts/test.js) there is no page: hand out the functions
    // that do not need one and stop here.
    if (typeof document === 'undefined') {
        if (typeof module !== 'undefined') module.exports = { parseM3U: parseM3U, versionNewer: versionNewer, isStreamUrl: isStreamUrl, cleanUserAgent: cleanUserAgent };
        return;
    }

    // ==========================================================================
    // Config / constants
    // ==========================================================================
    var APP_VERSION = '0.11.12';
    var PLAYLISTS_KEY = 'iptv_playlists';
    var ACTIVE_PLAYLISTS_KEY = 'iptv_active_playlist_id';
    var FAVORITES_KEY = 'iptv_favorites';
    var LAST_CHANNEL_KEY = 'iptv_last_channel';
    var PICTURE_TUNING_KEY = 'iptv_picture_tuning';
    var FAST_START_KEY = 'iptv_fast_start';
    var TAGGED_MODE_KEY = 'iptv_tagged_channels';
    var SEND_IDENTITY_KEY = 'iptv_send_identity';
    var FAILED_KEY = 'iptv_failed_channels';
    var FAILED_MAX = 300;
    var REOPEN_LAST_KEY = 'iptv_reopen_last';
    var REOPEN_PENDING_KEY = 'iptv_reopen_pending';
    var LOG_KEY = 'iptv_log';

    // Self-update: where the current app is published (GitHub Pages, served
    // from the repo's main branch) and where a downloaded copy is kept. The
    // keys are shared with js/boot.js, which starts a downloaded copy.
    // An update is one exact commit of the repository: the app first asks
    // GitHub which commit a branch points at, then downloads every file from
    // that commit. (Fetching the files by branch name does not work: GitHub
    // caches each file of a branch separately for some minutes, so right
    // after a push a TV can be handed the new script with the old page.)
    // Normally the branch is main; Developer mode follows dev instead, for
    // test versions that are not merged yet.
    var UPDATE_API = 'https://api.github.com/repos/miglworld/MyTvApp/commits/';
    var UPDATE_RAW = 'https://raw.githubusercontent.com/miglworld/MyTvApp/';
    var DEVELOPER_MODE_KEY = 'iptv_developer_mode';

    // Programme guide: a small file this repository builds every few hours
    // (scripts/build-guide.js) from a full guide feed, holding only the
    // playlists' channels and the next two days. Kept on the TV like a
    // playlist and fetched again when older than GUIDE_MAX_AGE_MS.
    var GUIDE_URL = 'https://raw.githubusercontent.com/miglworld/MyTvApp/guide/guide.json';
    var GUIDE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    var GUIDE_MAX_CHARS = 5 * 1000 * 1000;
    var UPDATE_KEY = 'mytvapp_update';
    var UPDATE_BAD_KEY = 'mytvapp_update_bad';
    var UPDATE_URL_KEY = 'mytvapp_update_url';   // testing only: another address to update from
    var AUTO_UPDATE_KEY = 'iptv_auto_update';
    var UPDATE_CHECK_DELAY_MS = 3000;

    // Playlist memory: stored copies are used at the start and downloaded
    // again in the background once they are older than this.
    var PLAYLIST_DB = 'mytvapp';
    var PLAYLIST_STORE = 'playlists';
    var PLAYLIST_MAX_AGE_MS = 6 * 60 * 60 * 1000;
    var PLAYLIST_REFRESH_DELAY_MS = 4000;
    var PLAYLIST_MAX_CHARS = 40 * 1000 * 1000;
    var LOG_LINES = 20;
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

    // Live TV screen: height of one channel row (matches css/style.css), and how
    // long the list has to rest on a channel before its preview starts.
    var LIVE_ROW_H = 84;
    // TV Guide grid: width of one minute, the step the time window moves by,
    // and the height of one channel row (matches css/style.css).
    var GUIDE_PX_PER_MIN = 8;
    var GUIDE_STEP_MIN = 30;
    var GUIDE_ROW_H = 80;
    var PREVIEW_DELAY_MS = 700;

    // Playback error handling limits — a dead stream gives up with a message
    // instead of retrying forever.
    var MAX_NETWORK_RETRIES = 3;
    var MAX_MEDIA_RECOVERIES = 2;

    // Samsung IME key codes (developer.samsung.com keyboard/IME guide).
    var IME_DONE = 65376;
    var IME_CANCEL = 65385;

    // Player: rows visible in the channel-list panel, and how long a typed
    // channel number waits for more digits before jumping.
    var PANEL_ROWS = 10;
    var NUMBER_ENTRY_MS = 2000;

    // ==========================================================================
    // State
    // ==========================================================================
    var state = {
        playlists: [],
        activePlaylistIds: [],
        channels: [],
        channelsByPlaylist: {},  // playlist id -> its channels (active playlists only)
        categories: [],          // [{ name, code, channels: [...] }] — grouped by group-title
        section: { type: 'all' }, // what the Live TV list shows: all | favorites | category (+ index)
        liveList: [],            // channels of that section
        liveIndex: 0,            // channel the list is on
        liveRows: 10,            // rows that fit in the list (measured when shown)
        fullscreen: false,       // picture is full screen (player), not the preview window
        zapTitle: '',            // title of the list being zapped through
        statusText: '',          // last player status line
        previewTimer: null,
        menuTimer: null,
        guideList: [],           // TV Guide: the channels that have a guide
        guideRow: 0,             // channel row the remote is on
        guideCursor: 0,          // the time the remote is at, in minutes since 1970
        guideStart: 0,           // first minute shown at the left edge
        guideRows: 8,            // rows that fit (measured when shown)
        fullFrom: 'screen-live', // screen full screen was opened from
        guide: null,             // { channelKey: [[start minute, length minutes, title, description?], ...] }
        watched: false,          // the channel that is playing has been shown full screen
        menuMode: 'root',        // side menu shows: 'root' (Live TV, Favorites, Settings) or 'live' (Live TV's own menu)
        favorites: [],
        nowPlaying: null,
        zapContext: 'category',  // 'category' | 'favorites'
        zapList: [],
        hls: null,
        overlayTimeoutId: null,
        toastTimeoutId: null,
        playToken: 0,
        isPlaying: false,
        engine: null,
        enginesLeft: [],
        playErrors: [],
        playFailed: false,
        watchdogId: null,
        avplayOpen: false,
        quality: '',             // picture size / bitrate last read from the player
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

    // Faster channel start (Settings switch, on by default): the Samsung
    // player shows the picture after buffering 2 seconds instead of its own,
    // longer default.
    var fastStart = true;
    try { fastStart = localStorage.getItem(FAST_START_KEY) !== '0'; } catch (e) { fastStart = true; }
    var fastStartFailureLogged = false;

    // Some playlists give a channel the browser identity ("user agent") its
    // server expects from a player. Settings switch, on by default: the
    // Samsung player announces itself with it for that channel.
    var sendIdentity = true;
    try { sendIdentity = localStorage.getItem(SEND_IDENTITY_KEY) !== '0'; } catch (e) { sendIdentity = true; }
    var identityFailureLogged = false;

    // Channels a playlist marks as "[Geo-blocked]" or "[Not 24/7]" often do
    // not play. Settings switch: 'dim' (default) shows them darker, 'hide'
    // leaves them out, 'show' treats them like any other.
    var taggedMode = 'dim';
    try { taggedMode = localStorage.getItem(TAGGED_MODE_KEY) || 'dim'; } catch (e) { taggedMode = 'dim'; }
    if (taggedMode !== 'hide' && taggedMode !== 'show') taggedMode = 'dim';

    function isTagged(ch) {
        return /\[(geo-blocked|not 24\/7)\]/i.test(ch.name || '');
    }

    // Channels that did not play the last time they were tried on this TV,
    // by address. Shown darker, with a note, until they play again.
    var failedChannels = {};
    var failedOrder = [];
    try {
        failedOrder = JSON.parse(localStorage.getItem(FAILED_KEY) || '[]') || [];
        failedOrder.forEach(function (url) { failedChannels[url] = true; });
    } catch (e) { failedChannels = {}; failedOrder = []; }

    function saveFailed() {
        try { localStorage.setItem(FAILED_KEY, JSON.stringify(failedOrder)); } catch (e) { /* non-fatal */ }
    }

    function markFailed(ch, failed) {
        if (!ch || !!failedChannels[ch.url] === failed) return;
        if (failed) {
            failedChannels[ch.url] = true;
            failedOrder.push(ch.url);
            // Keep the list bounded: forget the oldest.
            while (failedOrder.length > FAILED_MAX) delete failedChannels[failedOrder.shift()];
        } else {
            delete failedChannels[ch.url];
            failedOrder = failedOrder.filter(function (url) { return url !== ch.url; });
        }
        saveFailed();
    }

    // Reopen the last watched channel when the app starts. Off by default:
    // the app then always starts on its own screens, so a channel or player
    // problem can never look like an app that does not start.
    var reopenLast = false;
    try { reopenLast = localStorage.getItem(REOPEN_LAST_KEY) === '1'; } catch (e) { reopenLast = false; }

    // Automatic updates (Settings switch, on by default).
    var autoUpdate = true;
    try { autoUpdate = localStorage.getItem(AUTO_UPDATE_KEY) !== '0'; } catch (e) { autoUpdate = true; }
    var updateReady = '';   // version downloaded and waiting for the next start
    // Developer mode (Settings switch, off by default): take test versions
    // from the dev branch. There the TV follows the branch exactly, to
    // whatever version it holds, not only to higher ones.
    var developerMode = false;
    try { developerMode = localStorage.getItem(DEVELOPER_MODE_KEY) === '1'; } catch (e) { developerMode = false; }
    var bootTime = Date.now();

    // Diagnostics: a TV has no console, so the last few events are kept in
    // storage and listed at the bottom of Settings. They survive a restart,
    // which is what makes a freeze or a black screen explainable afterwards.
    var logLines = null;   // read from storage once (js/boot.js may have added lines before this script)
    function readLog() {
        if (!logLines) {
            try { logLines = JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { logLines = []; }
        }
        return logLines;
    }
    function logEvent(msg) {
        var d = new Date();
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        var lines = readLog();
        lines.push(two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + String(msg).slice(0, 160));
        if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
        try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch (e) { /* non-fatal */ }
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
            // The menu folds into a small capsule while the remote is elsewhere
            // (a dialog leaves it as it was).
            if (name !== 'confirmActions' && name !== 'updateNotice') {
                document.getElementById('sidebar').classList.toggle('collapsed', name !== 'sideMenu');
            }
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

    // Left from a screen's own controls goes to the side menu, onto the entry
    // of what is showing.
    function leftEdgeToMenu(zoneName) {
        Focus.zones[zoneName].onEdge = (function (existing) {
            return function (dir) {
                if (dir === 'left') {
                    enterMenu();
                } else if (existing) {
                    existing(dir);
                }
            };
        })(Focus.zones[zoneName].onEdge);
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
        if (Focus.currentZone === 'liveList') renderLiveList();
        if (Focus.currentZone === 'guideGrid') renderGuide();
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

    function activeScreenId() {
        var el = document.querySelector('.screen.active');
        return el ? el.id : '';
    }

    function switchToScreen(id) {
        // The picture only runs on the Live TV screen and full screen.
        if (id !== 'screen-live') stopPlayback();
        showScreen(id);
        markMenu();

        if (id === 'screen-live') {
            refreshLiveList(false);
            if (state.liveList.length) focusLiveList();
            else enterMenu();
        } else if (id === 'screen-settings') {
            renderPlaylistList();
            renderAppVersion();
            Focus.setZone('playlistList', 0, 0);
        }
    }

    // ==========================================================================
    // Side menu: Live TV (every channel), Favorites, one entry per category of
    // the active playlists, and Settings. Moving through it changes the channel
    // list at once; OK or Right goes into the list.
    // ==========================================================================
    function setMenuMode(mode) {
        state.menuMode = mode;
        document.getElementById('sidebar').classList.toggle('sub', mode === 'live');
    }

    function menuButtons() {
        if (state.menuMode === 'live') {
            var rows = [[document.getElementById('navBack')], [document.getElementById('navAll')]];
            var cats = document.querySelectorAll('#menuCategories .menu-item');
            for (var i = 0; i < cats.length; i++) rows.push([cats[i]]);
            return rows;
        }
        return [[document.getElementById('navLive')], [document.getElementById('navGuide')], [document.getElementById('navFavorites')], [document.getElementById('navSettings')]];
    }

    // What a menu row stands for, in the menu that is showing.
    function sectionForRow(row) {
        if (state.menuMode === 'live') {
            if (row === 1) return { type: 'all' };
            if (row >= 2 && row - 2 < state.categories.length) return { type: 'category', index: row - 2 };
            return null;   // the "Live TV" header
        }
        // Live TV keeps the category that was showing.
        if (row === 0) return state.section.type === 'favorites' ? { type: 'all' } : state.section;
        if (row === 2) return { type: 'favorites' };
        return null;       // TV Guide, Settings
    }

    function rowForSection(section) {
        if (state.menuMode === 'live') return section.type === 'category' ? 2 + section.index : 1;
        return section.type === 'favorites' ? 2 : 0;
    }

    function sameSection(a, b) {
        return a.type === b.type && (a.type !== 'category' || a.index === b.index);
    }

    function sectionChannels(section) {
        if (section.type === 'favorites') return visibleFavorites();
        if (section.type === 'category') return (state.categories[section.index] || { channels: [] }).channels;
        return state.channels;
    }

    function sectionTitle(section) {
        if (section.type === 'favorites') return 'Favorites';
        if (section.type === 'category') return (state.categories[section.index] || { name: 'Channels' }).name;
        return 'All channels';
    }

    function sectionContext(section) {
        return section.type === 'favorites' ? 'favorites' : 'category';
    }

    function onSettingsScreens() {
        return activeScreenId() === 'screen-settings' || activeScreenId() === 'screen-add';
    }

    function currentMenuRow() {
        if (state.menuMode === 'root' && onSettingsScreens()) return 3;
        if (state.menuMode === 'root' && activeScreenId() === 'screen-guide') return 1;
        return rowForSection(state.section);
    }

    // Moves the remote into the menu, onto the entry of what is showing: Live
    // TV's own menu while its channels are on screen, otherwise the main one.
    function enterMenu() {
        setMenuMode(activeScreenId() === 'screen-live' && state.section.type !== 'favorites' ? 'live' : 'root');
        Focus.setZone('sideMenu', currentMenuRow(), 0);
    }

    // Highlights the entries of what is showing, in both menus.
    function markMenu() {
        var guide = activeScreenId() === 'screen-guide';
        var settings = onSettingsScreens() || guide;   // "not a Live TV section"
        var type = state.section.type;
        document.getElementById('navLive').classList.toggle('active', !settings && type !== 'favorites');
        document.getElementById('navGuide').classList.toggle('active', guide);
        document.getElementById('navFavorites').classList.toggle('active', !settings && type === 'favorites');
        document.getElementById('navSettings').classList.toggle('active', settings && !guide);
        document.getElementById('navAll').classList.toggle('active', !settings && type === 'all');
        var cats = document.querySelectorAll('#menuCategories .menu-item');
        for (var i = 0; i < cats.length; i++) {
            cats[i].classList.toggle('active', !settings && type === 'category' && state.section.index === i);
        }
        // For the folded menu, which only has the three icons.
        document.getElementById('sidebar').setAttribute('data-root',
            guide ? 'guide' : (settings ? 'settings' : (type === 'favorites' ? 'favorites' : 'live')));
    }

    // Builds Live TV's menu: the categories of the active playlists.
    function renderSideMenu() {
        // A category that no longer exists (playlist switched off): back to everything.
        if (state.section.type === 'category' && !state.categories[state.section.index]) state.section = { type: 'all' };

        var box = document.getElementById('menuCategories');
        box.innerHTML = '';
        var playlistIds = {};
        var playlistCount = 0;
        state.categories.forEach(function (cat) {
            if (!playlistIds[cat.playlistId]) { playlistIds[cat.playlistId] = true; playlistCount++; }
        });
        var frag = document.createDocumentFragment();
        var lastPlaylistId = null;
        state.categories.forEach(function (cat, i) {
            // With several playlists active, their categories stay apart under a header each.
            if (playlistCount > 1 && cat.playlistId !== lastPlaylistId) {
                var header = document.createElement('div');
                header.className = 'menu-header';
                header.textContent = cat.playlistName || 'Playlist';
                frag.appendChild(header);
            }
            lastPlaylistId = cat.playlistId;

            var btn = document.createElement('button');
            btn.className = 'menu-item';
            btn.tabIndex = -1;
            var label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = cat.name;
            var count = document.createElement('span');
            count.className = 'menu-count';
            count.textContent = cat.channels.length;
            btn.appendChild(label);
            btn.appendChild(count);
            btn.addEventListener('click', function () { openSection({ type: 'category', index: i }); });
            frag.appendChild(btn);
        });
        box.appendChild(frag);
        // "Categories" heading: only when there is one playlist (several bring their own headings).
        document.getElementById('menuCategoriesHeader').hidden = playlistCount !== 1;
        updateMenuCounts();
        markMenu();
        // The buttons are new: put the highlight back if the remote is here.
        if (Focus.currentZone === 'sideMenu') Focus.apply();
    }

    function updateMenuCounts() {
        document.getElementById('navLiveCount').textContent = state.channels.length || '';
        document.getElementById('navAllCount').textContent = state.channels.length || '';
        document.getElementById('navFavoritesCount').textContent = visibleFavorites().length || '';
    }

    // Shows a section's channels in the list, without moving the remote.
    function showSection(section) {
        if (state.menuTimer) { clearTimeout(state.menuTimer); state.menuTimer = null; }
        state.section = section;
        if (activeScreenId() !== 'screen-live') showScreen('screen-live');
        refreshLiveList(true);
        markMenu();
    }

    // OK on All channels, a category or Favorites: show it and go into its channels.
    function openSection(section) {
        showSection(section);
        if (state.liveList.length) focusLiveList();
    }

    // OK or Right on Live TV: its own menu (All channels and the categories)
    // takes the place of the main one.
    function openLiveMenu() {
        showSection(state.section.type === 'favorites' ? { type: 'all' } : state.section);
        setMenuMode('live');
        Focus.setZone('sideMenu', currentMenuRow(), 0);
    }

    // The "Live TV" header, Left or Back in Live TV's menu: the main menu again.
    function closeLiveMenu() {
        if (state.menuTimer) { clearTimeout(state.menuTimer); state.menuTimer = null; }
        setMenuMode('root');
        Focus.setZone('sideMenu', 0, 0);
    }

    document.getElementById('navLive').addEventListener('click', openLiveMenu);
    document.getElementById('navGuide').addEventListener('click', openGuide);
    document.getElementById('navBack').addEventListener('click', closeLiveMenu);
    document.getElementById('navAll').addEventListener('click', function () { openSection({ type: 'all' }); });
    document.getElementById('navFavorites').addEventListener('click', function () { openSection({ type: 'favorites' }); });
    document.getElementById('navSettings').addEventListener('click', function () { switchToScreen('screen-settings'); });

    Focus.zones.sideMenu = {
        getMatrix: menuButtons,
        // Moving through the menu on the Live TV screen shows each section's
        // channels straight away (after a short pause, so holding a key down
        // does not rebuild the list for every entry passed).
        afterApply: function (row) {
            if (state.menuTimer) { clearTimeout(state.menuTimer); state.menuTimer = null; }
            if (activeScreenId() !== 'screen-live') return;
            var section = sectionForRow(row);
            if (!section || sameSection(section, state.section)) return;
            state.menuTimer = setTimeout(function () {
                state.menuTimer = null;
                if (activeScreenId() !== 'screen-live' || Focus.currentZone !== 'sideMenu') return;
                showSection(section);
            }, 150);
        },
        onEdge: function (dir) {
            if (dir === 'left') {
                if (state.menuMode === 'live') closeLiveMenu();
                return;
            }
            if (dir !== 'right') return;
            var screen = activeScreenId();
            if (screen === 'screen-settings') { Focus.setZone('playlistList', 0, 0); return; }
            if (state.menuMode === 'root' && Focus.row === 0) { openLiveMenu(); return; }
            if (state.menuMode === 'root' && Focus.row === 1) { openGuide(); return; }
            if (screen !== 'screen-live') {
                // From the guide: Right on Favorites shows them.
                if (state.menuMode === 'root' && Focus.row === 2) openSection({ type: 'favorites' });
                return;
            }
            // A section the pause above has not shown yet: show it now.
            var section = sectionForRow(Focus.row);
            if (!section) return;
            if (!sameSection(section, state.section)) showSection(section);
            if (state.liveList.length) focusLiveList();
        }
    };

    // ==========================================================================
    // Programme guide: what is on now and next.
    // ==========================================================================
    var GUIDE_ENTRY = { id: '__guide', url: GUIDE_URL };   // its place in the playlist store

    // "RTP1.pt@SD" -> "rtp1.pt", the name the guide file uses.
    function guideKey(ch) {
        if (ch.tvgId === undefined) {
            // A favorite saved before the guide existed: take the id from its channel.
            var i = indexByUrl(state.channels, ch.url);
            ch.tvgId = i === -1 ? '' : (state.channels[i].tvgId || '');
        }
        return String(ch.tvgId || '').split('@')[0].toLowerCase();
    }

    // { now, next }: programme entries, either may be null. null when the
    // guide has nothing for the channel at this moment.
    function nowNext(ch) {
        var list = state.guide && ch ? state.guide[guideKey(ch)] : null;
        if (!list || !list.length) return null;
        var minute = Date.now() / 60000;
        for (var i = 0; i < list.length; i++) {
            var start = list[i][0];
            if (start > minute) return { now: null, next: list[i] };
            if (minute < start + list[i][1]) return { now: list[i], next: list[i + 1] || null };
        }
        return null;
    }

    // Minutes since 1970 -> "14:25" in the TV's own time zone.
    function guideTime(minute) {
        var d = new Date(minute * 60000);
        var m = d.getMinutes();
        return d.getHours() + ':' + (m < 10 ? '0' : '') + m;
    }

    function useGuide(text) {
        var data = JSON.parse(text);
        if (!data || typeof data.channels !== 'object' || !data.channels) throw new Error('not a guide file');
        state.guide = data.channels;
        return Object.keys(state.guide).length;
    }

    // Start of the app: the stored guide at once, a fresh one when it is old.
    function loadGuide() {
        cacheGet(GUIDE_ENTRY).then(function (hit) {
            var fresh = false;
            if (hit) {
                try {
                    useGuide(hit.text);
                    fresh = Date.now() - hit.time < GUIDE_MAX_AGE_MS;
                    renderLiveList();
                } catch (e) { /* unusable copy: download */ }
            }
            if (fresh) return;
            return fetchWithTimeout(GUIDE_URL).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            }).then(function (text) {
                if (text.length > GUIDE_MAX_CHARS) throw new Error('guide is too large');
                var n = useGuide(text);
                cachePut(GUIDE_ENTRY, text);
                logEvent('guide: ' + n + ' channels');
                if (!state.fullscreen) renderLiveList();
                if (activeScreenId() === 'screen-guide') openGuide();
            });
        }).catch(function (err) {
            logEvent('guide not loaded: ' + ((err && err.message) || err));
        });
    }

    // ==========================================================================
    // TV Guide screen: the channels that have a guide down the left, time
    // across. The remote is on one programme: Left/Right move through that
    // channel's programmes, Up/Down change channel at the same time of day.
    // Like the Live TV list it is not a Focus matrix; its zone is 'guideGrid'.
    // ==========================================================================
    Focus.zones.guideGrid = { getMatrix: function () { return []; } };

    function nowMinute() {
        return Date.now() / 60000;
    }

    // The window never starts before the half hour that is running.
    function guideEarliest() {
        return Math.floor(nowMinute() / GUIDE_STEP_MIN) * GUIDE_STEP_MIN;
    }

    function guideProgrammes(ch) {
        return (state.guide && state.guide[guideKey(ch)]) || [];
    }

    // Index of the programme that covers `minute`; else the first one after
    // it; else the last one; -1 when there are none.
    function guideIndexAt(list, minute) {
        for (var i = 0; i < list.length; i++) {
            if (minute < list[i][0] + list[i][1]) return i;
        }
        return list.length - 1;
    }

    // Minutes of time the grid shows.
    function guideSpan() {
        var width = document.getElementById('guideRuler').clientWidth || 1400;
        return Math.max(60, Math.floor(width / GUIDE_PX_PER_MIN));
    }

    // Moves the time window so that `minute` is inside it.
    function guideShow(minute) {
        var span = guideSpan();
        var start = state.guideStart;
        while (minute >= start + span - GUIDE_STEP_MIN) start += GUIDE_STEP_MIN;
        while (minute < start) start -= GUIDE_STEP_MIN;
        state.guideStart = Math.max(guideEarliest(), start);
    }

    function openGuide() {
        if (state.menuTimer) { clearTimeout(state.menuTimer); state.menuTimer = null; }
        if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
        state.guideList = state.channels.filter(function (ch) { return guideProgrammes(ch).length > 0; });
        // Start on the channel that is playing, at the present.
        var row = state.nowPlaying ? indexByUrl(state.guideList, state.nowPlaying.url) : -1;
        state.guideRow = row === -1 ? 0 : row;
        state.guideCursor = nowMinute();
        state.guideStart = guideEarliest();
        setMenuMode('root');
        showScreen('screen-guide');
        markMenu();
        if (state.guideList.length) Focus.setZone('guideGrid', 0, 0);
        else Focus.setZone('sideMenu', 1, 0);
        renderGuide();
    }

    function guideFocused() {
        var ch = state.guideList[state.guideRow];
        if (!ch) return null;
        var list = guideProgrammes(ch);
        var index = guideIndexAt(list, Math.max(state.guideCursor, state.guideStart));
        return { ch: ch, list: list, index: index, prog: index === -1 ? null : list[index] };
    }

    function renderGuide() {
        var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        var rowsBox = document.getElementById('guideRows');
        var ruler = document.getElementById('guideRuler');
        rowsBox.innerHTML = '';
        ruler.innerHTML = '';

        if (!state.guideList.length) {
            var hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = state.guide ? 'The programme guide has nothing for the channels of your playlists.'
                : 'The programme guide is not loaded yet.';
            rowsBox.appendChild(hint);
            document.getElementById('guideInfoTitle').textContent = '';
            document.getElementById('guideInfoMeta').textContent = '';
            document.getElementById('guideInfoDesc').textContent = '';
            document.getElementById('guideInfoLive').hidden = true;
            document.getElementById('guideDate').textContent = '';
            return;
        }

        var start = state.guideStart = Math.max(state.guideStart, guideEarliest());
        var span = guideSpan();
        var end = start + span;
        var now = nowMinute();
        var hasFocus = Focus.currentZone === 'guideGrid';
        var focused = guideFocused();

        // Header: the day the left edge is in.
        var d = new Date(start * 60000);
        document.getElementById('guideDate').textContent = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];

        // Time ruler: one label per step.
        for (var t = start; t < end; t += GUIDE_STEP_MIN) {
            var tick = document.createElement('span');
            tick.className = 'guide-tick';
            tick.style.left = ((t - start) * GUIDE_PX_PER_MIN) + 'px';
            tick.textContent = guideTime(t);
            ruler.appendChild(tick);
        }

        if (rowsBox.clientHeight) state.guideRows = Math.max(2, Math.floor(rowsBox.clientHeight / GUIDE_ROW_H));
        var win = listWindow(state.guideRow, state.guideList.length, state.guideRows);
        var frag = document.createDocumentFragment();
        for (var r = win.start; r < win.end; r++) {
            var ch = state.guideList[r];
            var row = document.createElement('div');
            row.className = 'guide-row' + (r === state.guideRow ? ' current' : '');

            var cell = document.createElement('div');
            cell.className = 'guide-ch';
            var logo = document.createElement('span');
            logo.className = 'live-logo';
            if (ch.logo) logo.style.backgroundImage = 'url(' + JSON.stringify(ch.logo) + ')';
            else logo.textContent = (ch.name || '?').charAt(0).toUpperCase();
            var name = document.createElement('span');
            name.className = 'guide-ch-name';
            name.textContent = ch.name;
            cell.appendChild(logo);
            cell.appendChild(name);
            row.appendChild(cell);

            var track = document.createElement('div');
            track.className = 'guide-track';
            var list = guideProgrammes(ch);
            var any = false;
            for (var i = guideIndexAt(list, start); i !== -1 && i < list.length; i++) {
                var from = list[i][0];
                var to = from + list[i][1];
                if (from >= end) break;
                if (to <= start) continue;
                any = true;
                var left = (Math.max(from, start) - start) * GUIDE_PX_PER_MIN;
                var width = (Math.min(to, end) - Math.max(from, start)) * GUIDE_PX_PER_MIN - 4;
                var prog = document.createElement('div');
                prog.className = 'guide-cell' + (from <= now && now < to ? ' on' : '') +
                    (hasFocus && focused && r === state.guideRow && i === focused.index ? ' focused' : '');
                prog.style.left = left + 'px';
                prog.style.width = Math.max(6, width) + 'px';
                // Too narrow for words: a plain block.
                if (width >= 70) prog.textContent = String(list[i][2]);
                else prog.style.padding = '0';
                track.appendChild(prog);
            }
            if (!any) {
                var none = document.createElement('div');
                none.className = 'guide-cell empty';
                none.style.left = '0';
                none.textContent = 'No information';
                track.appendChild(none);
            }
            row.appendChild(track);
            frag.appendChild(row);
        }
        rowsBox.appendChild(frag);

        // The present, as a line through all rows.
        if (now >= start && now < end) {
            var line = document.createElement('div');
            line.className = 'guide-now';
            line.style.left = (document.querySelector('.guide-ch-space').offsetWidth + (now - start) * GUIDE_PX_PER_MIN) + 'px';
            rowsBox.appendChild(line);
        }

        // Details of the programme the remote is on.
        var p = focused && focused.prog;
        document.getElementById('guideInfoTitle').textContent = p ? String(p[2]) : (focused ? focused.ch.name : '');
        document.getElementById('guideInfoLive').hidden = !(p && p[0] <= now && now < p[0] + p[1]);
        document.getElementById('guideInfoMeta').textContent = p
            ? guideTime(p[0]) + ' – ' + guideTime(p[0] + p[1]) + ' · ' + focused.ch.name
            : '';
        document.getElementById('guideInfoDesc').textContent = p && p[3] ? String(p[3]) : '';
    }

    function moveGuideRow(delta) {
        var n = state.guideList.length;
        state.guideRow = Math.max(0, Math.min(n - 1, state.guideRow + delta));
        renderGuide();
    }

    function handleGuideKey(code) {
        var f = guideFocused();
        switch (code) {
            case KEYCODE.UP: moveGuideRow(-1); break;
            case KEYCODE.DOWN: moveGuideRow(1); break;
            case KEYCODE.CH_UP: moveGuideRow(-state.guideRows); break;
            case KEYCODE.CH_DOWN: moveGuideRow(state.guideRows); break;
            case KEYCODE.RIGHT:
                if (f && f.index !== -1 && f.index < f.list.length - 1) {
                    state.guideCursor = f.list[f.index + 1][0];
                    guideShow(state.guideCursor);
                    renderGuide();
                }
                break;
            case KEYCODE.LEFT:
                // The programme before, as long as it reaches into the time
                // that can be shown; at the start, the menu.
                var earliest = guideEarliest();
                if (f && f.index > 0 && f.list[f.index - 1][0] + f.list[f.index - 1][1] > earliest) {
                    state.guideCursor = Math.max(f.list[f.index - 1][0], earliest);
                    guideShow(state.guideCursor);
                    renderGuide();
                } else {
                    enterMenu();
                    renderGuide();
                }
                break;
            case KEYCODE.BACK:
                enterMenu();
                renderGuide();
                break;
            case KEYCODE.ENTER:
                if (!f || !f.prog) break;
                var now = nowMinute();
                if (f.prog[0] <= now && now < f.prog[0] + f.prog[1]) {
                    playChannel(f.ch, 'category', state.guideList, 'TV Guide');
                } else if (f.prog[0] > now) {
                    showToast('Starts at ' + guideTime(f.prog[0]));
                } else {
                    showToast('This programme has ended');
                }
                break;
            case KEYCODE.MEDIA_PLAY_PAUSE: if (state.nowPlaying) togglePlayPause(); break;
        }
    }

    // ==========================================================================
    // Live TV screen: the channel list of the section chosen in the menu, a
    // preview window and the channel's details. Only the rows that fit are
    // built, so a list of 10,000 channels costs the same as one of 10.
    // The list is not a Focus matrix: it has its own index (state.liveIndex)
    // and its own key handling (handleLiveKey), under the zone name 'liveList'.
    // ==========================================================================
    Focus.zones.liveList = { getMatrix: function () { return []; } };

    function indexByUrl(list, url) {
        for (var i = 0; i < list.length; i++) if (list[i].url === url) return i;
        return -1;
    }

    // First and one-past-last index of the rows to build, keeping `index` in the middle.
    function listWindow(index, total, rows) {
        var start = Math.max(0, Math.min(index - Math.floor(rows / 2), total - rows));
        return { start: start, end: Math.min(total, start + rows) };
    }

    // One channel row, for the Live TV list and the list over the video:
    // number, logo (or first letter), name, a dot on the channel that is
    // playing and a star on a favorite.
    function buildChannelRow(ch, stateClasses) {
        var failed = !!failedChannels[ch.url];
        var row = document.createElement('div');
        row.className = 'live-row' + stateClasses + (failed || (taggedMode === 'dim' && isTagged(ch)) ? ' dim' : '');

        var num = document.createElement('span');
        num.className = 'live-num';
        num.textContent = ch.number ? String(ch.number) : '';
        var logo = document.createElement('span');
        logo.className = 'live-logo';
        if (ch.logo) logo.style.backgroundImage = 'url(' + JSON.stringify(ch.logo) + ')';
        else logo.textContent = (ch.name || '?').charAt(0).toUpperCase();
        var text = document.createElement('span');
        text.className = 'live-text';
        var name = document.createElement('span');
        name.className = 'live-name';
        name.textContent = ch.name;
        text.appendChild(name);
        var on = nowNext(ch);
        if (failed || (on && on.now)) {
            var sub = document.createElement('span');
            sub.className = 'live-sub';
            sub.textContent = failed ? 'Did not play last time' : String(on.now[2]);
            text.appendChild(sub);
        }
        row.appendChild(num);
        row.appendChild(logo);
        row.appendChild(text);
        if (state.nowPlaying && ch.url === state.nowPlaying.url) {
            var playing = document.createElement('span');
            playing.className = 'live-playing';
            row.appendChild(playing);
        }
        if (isFavorited(ch)) {
            var star = document.createElement('span');
            star.className = 'live-mark';
            star.textContent = '\u2605';
            row.appendChild(star);
        }
        return row;
    }

    // Rebuilds the list for the current section. Unless reset, it stays on the
    // channel it was on; otherwise it starts on the channel that is playing.
    function refreshLiveList(reset) {
        var current = state.liveList[state.liveIndex];
        var want = (!reset && current) ? current.url : (state.nowPlaying ? state.nowPlaying.url : null);
        state.liveList = sectionChannels(state.section);
        var idx = want ? indexByUrl(state.liveList, want) : -1;
        // Its channel is gone (a favorite just removed): stay at the same place in the list.
        if (idx === -1) idx = reset ? 0 : Math.max(0, Math.min(state.liveIndex, state.liveList.length - 1));
        state.liveIndex = idx;
        var n = state.liveList.length;
        document.getElementById('liveTitle').textContent = sectionTitle(state.section);
        document.getElementById('liveCount').textContent = n + (n === 1 ? ' channel' : ' channels');
        renderLiveList();
    }

    function renderLiveList() {
        var box = document.getElementById('liveList');
        box.innerHTML = '';
        var list = state.liveList;
        if (!list.length) {
            var hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = state.section.type === 'favorites'
                ? 'No favorites yet. Press ▶ on a channel to add it.'
                : 'No channels yet. Add or switch on a playlist in Settings.';
            box.appendChild(hint);
            updateLiveInfo();
            return;
        }
        if (box.clientHeight) state.liveRows = Math.max(3, Math.floor(box.clientHeight / LIVE_ROW_H));
        var win = listWindow(state.liveIndex, list.length, state.liveRows);
        var hasFocus = Focus.currentZone === 'liveList';
        var frag = document.createDocumentFragment();
        for (var i = win.start; i < win.end; i++) {
            frag.appendChild(buildChannelRow(list[i], i === state.liveIndex ? (hasFocus ? ' selected focused' : ' selected') : ''));
        }
        box.appendChild(frag);
        updateLiveInfo();
    }

    // Caption of the channel the list is on, over the picture.
    function updateLiveInfo() {
        var ch = state.liveList[state.liveIndex] || null;
        var isCurrent = !!(ch && state.nowPlaying && state.nowPlaying.url === ch.url);
        document.getElementById('liveInfoName').textContent = ch ? ch.name : 'MyTvApp';
        document.getElementById('liveInfoNumber').textContent = ch && ch.number ? String(ch.number) : '';
        var parts = [];
        if (ch && ch.group) parts.push(ch.group);
        if (ch && ch.playlistName) parts.push(ch.playlistName);
        document.getElementById('liveInfoGroup').textContent = parts.join(' · ');
        showProgramme(ch);
        document.getElementById('liveInfoFav').hidden = !(ch && isFavorited(ch));
        document.getElementById('liveInfoLive').hidden = !(isCurrent && state.isPlaying);
        document.getElementById('liveStatus').textContent = isCurrent ? state.statusText : '';
    }

    // The programme part of the caption: title, times, how far along it is,
    // a short description and what follows. Hidden when the guide has nothing.
    function showProgramme(ch) {
        var on = nowNext(ch);
        var box = document.getElementById('liveProg');
        box.hidden = !on;
        if (!on) return;
        var now = on.now;
        document.getElementById('liveProgTitle').textContent = now ? String(now[2]) : '';
        document.getElementById('liveProgTime').textContent = now ? guideTime(now[0]) + ' \u2013 ' + guideTime(now[0] + now[1]) : '';
        document.getElementById('liveProgBar').hidden = !now;
        if (now) {
            var done = (Date.now() / 60000 - now[0]) / now[1];
            document.getElementById('liveProgFill').style.width = Math.max(0, Math.min(100, Math.round(done * 100))) + '%';
        }
        document.getElementById('liveProgDesc').textContent = now && now[3] ? String(now[3]) : '';
        document.getElementById('liveProgNext').textContent = on.next ? 'Next \u00b7 ' + guideTime(on.next[0]) + ' \u00b7 ' + String(on.next[2]) : '';
    }

    function updateClock() {
        var d = new Date();
        var m = d.getMinutes();
        document.getElementById('liveClock').textContent = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
        // Programmes move on with the clock.
        if (state.guide && !state.fullscreen && activeScreenId() === 'screen-live') updateLiveInfo();
        if (activeScreenId() === 'screen-guide') renderGuide();
    }
    updateClock();
    setInterval(updateClock, 20000);

    function focusLiveList() {
        Focus.setZone('liveList', 0, 0);   // clears the menu's highlight
        renderLiveList();
        schedulePreview();
    }

    function moveLive(delta) {
        var n = state.liveList.length;
        if (!n) return;
        if (Math.abs(delta) === 1) state.liveIndex = (state.liveIndex + delta + n) % n;
        else state.liveIndex = Math.max(0, Math.min(n - 1, state.liveIndex + delta));
        renderLiveList();
        schedulePreview();
    }

    // Starts the preview of the channel the list rests on.
    function schedulePreview() {
        if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
        if (activeScreenId() !== 'screen-live') return;
        state.previewTimer = setTimeout(function () {
            state.previewTimer = null;
            var ch = state.liveList[state.liveIndex];
            // Only while the remote is still in the list: a timer armed before
            // it moved to the menu must not start a channel.
            if (!ch || state.fullscreen || activeScreenId() !== 'screen-live' || Focus.currentZone !== 'liveList') return;
            if (state.nowPlaying && state.nowPlaying.url === ch.url) return;
            tune(ch, sectionContext(state.section), state.liveList, sectionTitle(state.section));
        }, PREVIEW_DELAY_MS);
    }

    function handleLiveKey(code) {
        var ch = state.liveList[state.liveIndex];
        switch (code) {
            case KEYCODE.UP: moveLive(-1); break;
            case KEYCODE.DOWN: moveLive(1); break;
            case KEYCODE.CH_UP: moveLive(-state.liveRows); break;
            case KEYCODE.CH_DOWN: moveLive(state.liveRows); break;
            case KEYCODE.LEFT: case KEYCODE.BACK:
                enterMenu();
                break;
            case KEYCODE.ENTER:
                if (!ch) break;
                // Already in the preview: just make it full screen, no restart.
                if (state.nowPlaying && state.nowPlaying.url === ch.url) enterFullscreen();
                else playChannel(ch, sectionContext(state.section), state.liveList, sectionTitle(state.section));
                break;
            case KEYCODE.RIGHT: if (ch) toggleFavorite(ch); break;
            case KEYCODE.MEDIA_PLAY_PAUSE: if (state.nowPlaying) togglePlayPause(); break;
        }
    }

    // After a favorite is added or removed.
    function liveFavoritesChanged() {
        updateMenuCounts();
        if (state.section.type === 'favorites') {
            refreshLiveList(false);
            if (Focus.currentZone === 'liveList') schedulePreview();
        } else {
            renderLiveList();
        }
    }

    // ==========================================================================
    // M3U parsing
    // ==========================================================================
    function isStreamUrl(url) {
        return /^(https?|rtmps?|rtsp|rtp|udp|mms|mmsh):\/\/\S+$/i.test(url);
    }

    // Logos are loaded as images from the playlist's own addresses: web
    // addresses only.
    function safeLogo(url) {
        return /^https?:\/\/\S+$/i.test(url || '') ? url : '';
    }

    // A user agent as a playlist gives it, made safe to hand to the player:
    // one line of printable characters, not overly long. (A line break in it
    // could otherwise add request headers of the playlist author's choosing.)
    function cleanUserAgent(value) {
        var ua = String(value || '').replace(/[^\x20-\x7e]/g, '').trim();
        return ua.length > 300 ? '' : ua;
    }

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
                    logo: safeLogo(attrs['tvg-logo']),
                    group: attrs['group-title'] || 'Other',
                    tvgId: attrs['tvg-id'] || '',
                    tvgCountry: attrs['tvg-country'] || '',
                    chno: attrs['tvg-chno'] || '',
                    // Given as an attribute here, or as an #EXTVLCOPT line below.
                    userAgent: cleanUserAgent(attrs['user-agent'] || attrs['http-user-agent'])
                };
            } else if (line.indexOf('#EXTGRP:') === 0) {
                // Group given on its own line instead of group-title.
                if (pending && pending.group === 'Other') pending.group = line.slice(8).trim() || 'Other';
            } else if (line.indexOf('#EXTVLCOPT:http-user-agent=') === 0) {
                // Player option for the entry above: the identity its server expects.
                if (pending) pending.userAgent = cleanUserAgent(line.slice(27)) || pending.userAgent;
            } else if (line.indexOf('#') !== 0) {
                // Playlists come from anywhere: only real stream addresses are
                // accepted, never file:, javascript:, data: or relative paths.
                if (pending && isStreamUrl(line)) { pending.url = line; channels.push(pending); }
                pending = null;
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
    // options: extra fetch settings (headers), optional.
    function fetchWithTimeout(url, options) {
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
            var settings = options || {};
            if (ctrl) settings.signal = ctrl.signal;
            fetch(url, settings).then(function (res) {
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

    // --------------------------------------------------------------------------
    // Playlist memory. The text of every playlist is kept on the TV
    // (IndexedDB: a full country list is several MB, too big for localStorage).
    // A start shows the stored copy at once; a copy older than
    // PLAYLIST_MAX_AGE_MS is downloaded again in the background. Without
    // IndexedDB everything still works, by downloading on every start.
    // --------------------------------------------------------------------------
    var cacheDbPromise = null;

    function openCache() {
        if (cacheDbPromise) return cacheDbPromise;
        cacheDbPromise = new Promise(function (resolve) {
            var done = false;
            function finish(db) { if (!done) { done = true; resolve(db); } }
            // Never let the start wait on storage that does not answer.
            setTimeout(function () { finish(null); }, 2000);
            try {
                var req = window.indexedDB.open(PLAYLIST_DB, 1);
                req.onupgradeneeded = function () { req.result.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' }); };
                req.onsuccess = function () { finish(req.result); };
                req.onerror = req.onblocked = function () { finish(null); };
            } catch (e) { finish(null); }
        });
        return cacheDbPromise;
    }

    // Resolves to { text, time } for this playlist's current URL, or null.
    function cacheGet(pl) {
        return openCache().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve) {
                var done = false;
                function finish(v) { if (!done) { done = true; resolve(v); } }
                setTimeout(function () { finish(null); }, 3000);
                try {
                    var req = db.transaction(PLAYLIST_STORE, 'readonly').objectStore(PLAYLIST_STORE).get(pl.id);
                    req.onsuccess = function () {
                        var e = req.result;
                        finish(e && e.url === pl.url && e.text ? e : null);
                    };
                    req.onerror = function () { finish(null); };
                } catch (e) { finish(null); }
            });
        });
    }

    function cachePut(pl, text) {
        openCache().then(function (db) {
            if (!db) return;
            try {
                db.transaction(PLAYLIST_STORE, 'readwrite').objectStore(PLAYLIST_STORE)
                    .put({ id: pl.id, url: pl.url, text: text, time: Date.now() });
            } catch (e) { /* non-fatal: the playlist is downloaded again next time */ }
        });
    }

    function cacheDelete(playlistId) {
        openCache().then(function (db) {
            if (!db) return;
            try { db.transaction(PLAYLIST_STORE, 'readwrite').objectStore(PLAYLIST_STORE).delete(playlistId); } catch (e) { /* non-fatal */ }
        });
    }

    function channelsFromText(pl, text) {
        var parsed = parseM3U(text);
        if (!parsed.length) throw new Error('No channels found');
        // Channel number: the playlist's tvg-chno when present, else list position.
        parsed.forEach(function (ch, i) {
            ch.playlistId = pl.id;
            ch.playlistName = pl.name;
            ch.number = parseInt(ch.chno, 10) || (i + 1);
        });
        return parsed;
    }

    // Downloads a playlist, stores its text and resolves to { channels, text }.
    function downloadPlaylist(pl) {
        return fetchWithTimeout(pl.url)
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
            .then(function (text) {
                // A playlist far beyond any real one would only exhaust the TV's memory and storage.
                if (text.length > PLAYLIST_MAX_CHARS) throw new Error('Playlist is too large');
                var channels = channelsFromText(pl, text);
                cachePut(pl, text);
                return { channels: channels, text: text };
            });
    }

    // state.channels is always the active playlists' channels, in the order
    // the playlists are listed in Settings.
    function rebuildChannels() {
        var all = [];
        state.playlists.forEach(function (pl) {
            var list = state.channelsByPlaylist[pl.id];
            if (list && state.activePlaylistIds.indexOf(pl.id) !== -1) all = all.concat(list);
        });
        if (taggedMode === 'hide') all = all.filter(function (ch) { return !isTagged(ch); });
        state.channels = all;
        // The section points at a category by position; positions change when
        // playlists do, so find the same category again afterwards.
        var shown = state.section.type === 'category' ? state.categories[state.section.index] : null;
        rebuildCategories();
        if (shown) {
            state.section = { type: 'all' };
            for (var i = 0; i < state.categories.length; i++) {
                if (state.categories[i].playlistId === shown.playlistId && state.categories[i].name === shown.name) {
                    state.section = { type: 'category', index: i };
                    break;
                }
            }
        }
        renderSideMenu();
        refreshLiveList(false);
    }

    // Start of the app: every active playlist comes from its stored copy when
    // there is one, otherwise from the network. One bad playlist shows an
    // error for itself without blanking out the others.
    function refreshActiveChannels(options) {
        options = options || {};
        var activePlaylists = state.playlists.filter(function (p) { return state.activePlaylistIds.indexOf(p.id) !== -1; });
        state.channelsByPlaylist = {};

        function show() {
            rebuildChannels();
            showLoading(false);
            if (options.screen) switchToScreen(options.screen);
            if (options.after) options.after();
        }

        if (!activePlaylists.length) { show(); return; }

        showLoading(true);
        Promise.all(activePlaylists.map(function (pl) {
            return cacheGet(pl).then(function (hit) {
                if (hit) {
                    try { return { pl: pl, channels: channelsFromText(pl, hit.text), cached: hit }; } catch (e) { /* unusable copy: download */ }
                }
                return downloadPlaylist(pl).then(function (r) { return { pl: pl, channels: r.channels }; });
            }).catch(function (err) { return { pl: pl, channels: [], error: err }; });
        })).then(function (results) {
            var failures = [];
            var total = 0;
            var stored = 0;
            results.forEach(function (r) {
                if (r.error) { failures.push(r.pl.name + ': ' + r.error.message); return; }
                state.channelsByPlaylist[r.pl.id] = r.channels;
                total += r.channels.length;
                if (r.cached) stored++;
            });
            logEvent('playlists: ' + total + ' channels' + (stored ? ' (' + stored + ' from memory)' : '') +
                (failures.length ? ', failed: ' + failures.join('; ') : ''));
            show();
            if (failures.length) showToast('Could not load ' + failures.join('; '));

            // Stored copies that are getting old: fetch a fresh one, a little
            // after the start so it does not compete with the first screen.
            results.forEach(function (r) {
                if (r.cached && Date.now() - r.cached.time > PLAYLIST_MAX_AGE_MS) {
                    setTimeout(function () { refreshInBackground(r.pl, r.cached.text); }, PLAYLIST_REFRESH_DELAY_MS);
                }
            });
        });
    }

    // Replaces a playlist's channels with a fresh download. The new list is
    // shown right away only on the home or settings screen; while someone is
    // browsing or watching it waits for the next start (it is stored already).
    function refreshInBackground(pl, oldText) {
        downloadPlaylist(pl).then(function (r) {
            if (r.text === oldText) { logEvent('playlist "' + pl.name + '": no changes'); return; }
            var screen = activeScreenId();
            var idle = (screen === 'screen-live' || screen === 'screen-settings') && !state.fullscreen &&
                state.activePlaylistIds.indexOf(pl.id) !== -1;
            if (!idle) { logEvent('playlist "' + pl.name + '" refreshed: shows on the next start'); return; }
            state.channelsByPlaylist[pl.id] = r.channels;
            rebuildChannels();
            logEvent('playlist "' + pl.name + '" refreshed: ' + r.channels.length + ' channels');
        }).catch(function (err) {
            logEvent('playlist "' + pl.name + '" refresh failed: ' + ((err && err.message) || err));
        });
    }

    // Instantly drops a playlist's channels from the merged list (switched
    // off or deleted). Its stored copy stays, for when it is switched on again.
    function removeChannelsForPlaylist(playlistId) {
        delete state.channelsByPlaylist[playlistId];
        rebuildChannels();
    }

    // Downloads one playlist now and merges its channels in, replacing any it
    // already contributed (switching it on, editing its URL, "Reload").
    // Resolves to null, or to the error. On an error the channels it already
    // had stay as they are.
    function loadChannelsForPlaylist(pl) {
        showLoading(true);
        return downloadPlaylist(pl)
            .then(function (r) {
                state.channelsByPlaylist[pl.id] = r.channels;
                rebuildChannels();
                showLoading(false);
                return null;
            })
            .catch(function (err) {
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
            state.favorites.push({ name: ch.name, url: ch.url, logo: ch.logo, group: ch.group, tvgId: ch.tvgId, userAgent: ch.userAgent, tvgCountry: ch.tvgCountry, playlistId: ch.playlistId, number: ch.number });
            showToast('Added to Favorites');
        } else {
            state.favorites.splice(idx, 1);
            showToast('Removed from Favorites');
        }
        saveFavorites();
        liveFavoritesChanged();
        updateFavoriteButton();
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

        var fastRow = document.createElement('button');
        fastRow.className = 'playlist-row add-row option-row second';
        fastRow.tabIndex = -1;
        fastRow.textContent = 'Faster channel start: ' + (fastStart ? 'On' : 'Off');
        fastRow.addEventListener('click', function () {
            fastStart = !fastStart;
            try { localStorage.setItem(FAST_START_KEY, fastStart ? '1' : '0'); } catch (e) { /* non-fatal */ }
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
            showToast(fastStart ? 'Faster channel start on. If channels stutter, turn it off' : 'Faster channel start off');
        });
        list.appendChild(fastRow);

        var identityRow = document.createElement('button');
        identityRow.className = 'playlist-row add-row option-row second';
        identityRow.tabIndex = -1;
        identityRow.textContent = 'Use the browser identity a playlist gives for a channel: ' + (sendIdentity ? 'On' : 'Off');
        identityRow.addEventListener('click', function () {
            sendIdentity = !sendIdentity;
            try { localStorage.setItem(SEND_IDENTITY_KEY, sendIdentity ? '1' : '0'); } catch (e) { /* non-fatal */ }
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
        });
        list.appendChild(identityRow);

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
                if (autoUpdate) checkForUpdate(true);
                else showToast('Automatic updates off. The built-in version ' + window.MYTVAPP_BUNDLED + ' runs from the next start');
            });
            list.appendChild(updateRow);

            var checkRow = document.createElement('button');
            checkRow.className = 'playlist-row add-row option-row second';
            checkRow.tabIndex = -1;
            checkRow.textContent = 'Check for updates now';
            checkRow.addEventListener('click', function () {
                showToast('Checking for updates\u2026');
                checkForUpdate(true);
            });
            list.appendChild(checkRow);

            var devRow = document.createElement('button');
            devRow.className = 'playlist-row add-row option-row second';
            devRow.tabIndex = -1;
            devRow.textContent = 'Developer mode (test versions from the dev branch): ' + (developerMode ? 'On' : 'Off');
            devRow.addEventListener('click', function () {
                developerMode = !developerMode;
                try {
                    localStorage.setItem(DEVELOPER_MODE_KEY, developerMode ? '1' : '0');
                    // Off: forget the test version. The next start runs the
                    // package's own version, which then updates to the released one.
                    if (!developerMode) { localStorage.removeItem(UPDATE_KEY); updateReady = ''; }
                } catch (e) { /* non-fatal */ }
                logEvent('developer mode ' + (developerMode ? 'on' : 'off'));
                renderPlaylistList();
                renderAppVersion();
                Focus.setZone('playlistList', Focus.row, 0);
                if (developerMode) { showToast('Developer mode on: checking the dev branch\u2026'); checkForUpdate(true); }
                else showToast('Developer mode off: restart the app to return to the released version');
            });
            list.appendChild(devRow);
        }

        if (state.activePlaylistIds.length) {
            var reloadRow = document.createElement('button');
            reloadRow.className = 'playlist-row add-row option-row second';
            reloadRow.tabIndex = -1;
            reloadRow.textContent = 'Reload playlists now';
            reloadRow.addEventListener('click', reloadAllPlaylists);
            list.appendChild(reloadRow);
        }

        var taggedRow = document.createElement('button');
        taggedRow.className = 'playlist-row add-row option-row second';
        taggedRow.tabIndex = -1;
        taggedRow.textContent = 'Channels marked \u201cGeo-blocked\u201d or \u201cNot 24/7\u201d: ' +
            (taggedMode === 'hide' ? 'Hidden' : (taggedMode === 'show' ? 'Shown as normal' : 'Dimmed'));
        taggedRow.addEventListener('click', function () {
            taggedMode = taggedMode === 'dim' ? 'hide' : (taggedMode === 'hide' ? 'show' : 'dim');
            try { localStorage.setItem(TAGGED_MODE_KEY, taggedMode); } catch (e) { /* non-fatal */ }
            rebuildChannels();
            renderPlaylistList();
            Focus.setZone('playlistList', Focus.row, 0);
        });
        list.appendChild(taggedRow);

        if (failedOrder.length) {
            var failedRow = document.createElement('button');
            failedRow.className = 'playlist-row add-row option-row second';
            failedRow.tabIndex = -1;
            failedRow.textContent = 'Forget the ' + failedOrder.length + (failedOrder.length === 1 ? ' channel' : ' channels') + ' marked as not playing';
            failedRow.addEventListener('click', function () {
                failedChannels = {};
                failedOrder = [];
                saveFailed();
                renderPlaylistList();
                Focus.setZone('playlistList', Focus.row, 0);
                showToast('Forgotten');
            });
            list.appendChild(failedRow);
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

    // Settings "Reload playlists now": download every active playlist again,
    // one after another, instead of waiting for the stored copies to age.
    function reloadAllPlaylists() {
        var active = state.playlists.filter(function (p) { return state.activePlaylistIds.indexOf(p.id) !== -1; });
        var failed = [];
        active.reduce(function (chain, pl) {
            return chain.then(function () { return loadChannelsForPlaylist(pl); })
                .then(function (err) { if (err) failed.push(pl.name + ': ' + err.message); });
        }, Promise.resolve()).then(function () {
            logEvent('playlists reloaded' + (failed.length ? ', failed: ' + failed.join('; ') : ''));
            showToast(failed.length ? 'Could not reload ' + failed.join('; ') : 'Playlists reloaded');
        });
    }

    // Which copy is running: a downloaded update, the installed package's
    // own copy, or a web page / TizenBrew module.
    function renderAppVersion() {
        var source = window.MYTVAPP_SOURCE ||
            (location.protocol.indexOf('http') === 0 ? 'web / TizenBrew module' : 'installed package');
        var player = hasAvplay ? 'Samsung player available' : 'Samsung player not available';
        var update = updateReady ? ' \u00b7 update ' + updateReady + ' ready: restart the app' : '';
        var dev = developerMode ? ' \u00b7 developer mode' : '';
        document.getElementById('appVersion').textContent = 'MyTvApp ' + APP_VERSION + ' \u00b7 running from ' + source + ' \u00b7 ' + player + dev + update;
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

    function fetchUpdateText(url, options) {
        return fetchWithTimeout(url, options).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        });
    }

    // manual: started from Settings, so it reports back and may restart at once.
    function checkForUpdate(manual) {
        if (!updatesPossible() || (!autoUpdate && !manual)) return;
        var branch = developerMode ? 'dev' : 'main';
        var channel = developerMode ? 'dev branch' : 'main';
        var version = '';
        var base = '';

        // The test override only works on a developer's own machine. On a TV
        // the app can only ever update from the two GitHub addresses above.
        var override = null;
        if (location.hostname === 'localhost') {
            try { override = localStorage.getItem(UPDATE_URL_KEY); } catch (e) { override = null; }
        }
        var findBase = override ? Promise.resolve(override)
            : fetchUpdateText(UPDATE_API + branch, { headers: { Accept: 'application/vnd.github.sha' } }).then(function (sha) {
                sha = String(sha).trim();
                if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('unexpected answer for the ' + branch + ' commit');
                return UPDATE_RAW + sha + '/';
            });

        findBase.then(function (found) {
            base = found;
            return fetchUpdateText(base + 'package.json');
        }).then(function (text) {
            version = String(JSON.parse(text).version || '');
            var wanted = developerMode ? (version !== '' && version !== APP_VERSION) : versionNewer(version, APP_VERSION);
            // js/boot.js only starts a download that is newer than the
            // package itself; anything else would be fetched again and again.
            if (wanted && !versionNewer(version, window.MYTVAPP_BUNDLED)) {
                logEvent('update check (' + channel + '): ' + version + ' is not newer than the installed package ' + window.MYTVAPP_BUNDLED);
                if (manual) showToast('Version ' + version + ' is not newer than the installed package');
                return null;
            }
            if (!wanted) {
                logEvent('update check (' + channel + '): ' + APP_VERSION + ' is current');
                if (manual) showToast('MyTvApp ' + APP_VERSION + ' is the current version');
                return null;
            }
            var bad = null;
            try { bad = localStorage.getItem(UPDATE_BAD_KEY); } catch (e) { bad = null; }
            // A version that failed to start is not fetched again by itself.
            // "Check for updates now" may try it once more.
            if (bad === version && !manual) {
                logEvent('update ' + version + ' skipped: it failed to start before');
                return null;
            }
            return Promise.all([
                fetchUpdateText(base + 'index.html'),
                fetchUpdateText(base + 'css/style.css'),
                fetchUpdateText(base + 'js/main.js')
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
            // Every part of the page the script reaches for must be in the page.
            var ids = js.match(/getElementById\('[A-Za-z0-9_-]+'\)/g) || [];
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i].slice(16, -2);
                if (!doc.getElementById(id)) throw new Error('page and script do not match (' + id + ')');
            }
            localStorage.setItem(UPDATE_KEY, JSON.stringify({ version: version, js: js, css: files[1], html: app.innerHTML }));
            localStorage.removeItem(UPDATE_BAD_KEY);
            // This app is clearly running: a start-up check still open from this
            // start (js/boot.js) must not be held against the new download.
            localStorage.removeItem('mytvapp_update_pending');
            updateReady = version;
            logEvent('update ' + version + ' downloaded (' + channel + ')');
            applyUpdateOrAnnounce(version);
        }).catch(function (err) {
            logEvent('update check failed (' + channel + '): ' + ((err && err.message) || err));
            if (manual) showToast('Update check failed: ' + ((err && err.message) || err));
        });
    }

    // An update has been downloaded: a small notice in the top right corner
    // asks whether to restart into it now. It takes the remote while it is
    // up (Left/Right between its two buttons, Back means Later). It waits
    // while a channel is full screen, a URL is being typed or a dialog is
    // open, and it is shown once: "Later" leaves the update for the next start.
    var updateAsked = false;
    var noticeReturnZone = null;

    Focus.zones.updateNotice = {
        getMatrix: function () {
            return [[document.getElementById('updateLaterBtn'), document.getElementById('updateNowBtn')]];
        }
    };

    function applyUpdateOrAnnounce(version) {
        updateAsked = false;
        if (activeScreenId() === 'screen-settings') renderAppVersion();
        if (!askAboutUpdate()) showToast('MyTvApp ' + version + ' is ready to install');
    }

    // Returns true when the notice was put on screen.
    function askAboutUpdate() {
        if (!updateReady || updateAsked) return false;
        if (state.fullscreen || activeScreenId() === 'screen-add' || !document.getElementById('confirmModal').hidden) return false;
        updateAsked = true;
        noticeReturnZone = { name: Focus.currentZone, row: Focus.row, col: Focus.col };
        document.getElementById('updateNoticeText').textContent = 'MyTvApp ' + updateReady + ' is ready to install.';
        document.getElementById('updateNotice').hidden = false;
        Focus.setZone('updateNotice', 0, 1);   // on "Update now"
        return true;
    }

    function closeUpdateNotice() {
        document.getElementById('updateNotice').hidden = true;
        if (noticeReturnZone) Focus.setZone(noticeReturnZone.name, noticeReturnZone.row, noticeReturnZone.col);
        noticeReturnZone = null;
        if (Focus.currentZone === 'liveList') renderLiveList();
        if (Focus.currentZone === 'guideGrid') renderGuide();
    }

    document.getElementById('updateNowBtn').addEventListener('click', function () { location.reload(); });
    document.getElementById('updateLaterBtn').addEventListener('click', function () {
        closeUpdateNotice();
        showToast('MyTvApp ' + updateReady + ' will be installed the next time the app starts');
    });

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
    leftEdgeToMenu('playlistList');

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
            cacheDelete(pl.id);
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
        switchToScreen('screen-settings');
    });

    // ==========================================================================
    // Playing a channel. One playback serves both views: behind the Live TV
    // screen, and full screen. Switching between them only shows or hides the
    // menu and the list; the stream is not restarted and the picture never moves.
    // ==========================================================================

    // The picture is always full size. On the Live TV screen it lies under
    // the menu and the channel list (class "preview"); full screen it is on
    // top with the player's own overlays.
    function placeVideo() {
        document.getElementById('screen-player').classList.toggle('preview', !state.fullscreen);
    }

    // Starts a channel in the view that is showing.
    function tune(ch, context, list, title) {
        // "Previous channel" is the last one watched full screen, not one the
        // list merely rested on.
        var current = state.nowPlaying && state.watched ? state.nowPlaying : state.lastExited;
        if (current && current.url !== ch.url) {
            state.prevChannel = { ch: current, context: state.zapContext, list: state.zapList, title: state.zapTitle };
            state.lastExited = null;
        } else if (state.nowPlaying && state.watched) {
            state.lastExited = null;
        }
        state.watched = state.fullscreen;
        state.nowPlaying = ch;
        state.zapContext = context;
        state.zapList = list && list.length ? list : [ch];
        state.zapTitle = title || 'Channels';
        closeChannelPanel();
        endInfoInteractive();
        placeVideo();
        startPlayback();
        if (!state.fullscreen) renderLiveList();
    }

    // Starts a channel full screen.
    function playChannel(ch, context, list, title) {
        if (!state.fullscreen) {
            if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
            state.fullFrom = activeScreenId();
            state.fullscreen = true;
            document.documentElement.classList.add('video-full');
            showScreen('screen-player');
        }
        tune(ch, context, list, title);
    }

    // Preview window -> full screen, same stream.
    function enterFullscreen() {
        if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
        state.fullFrom = activeScreenId();
        state.fullscreen = true;
        state.watched = true;
        if (state.nowPlaying && state.isPlaying) saveLastChannel(state.nowPlaying, state.zapContext);
        document.documentElement.classList.add('video-full');
        showScreen('screen-player');
        placeVideo();
        showOverlay();
    }

    // Full screen -> back to the Live TV screen; the channel keeps playing in
    // the preview window and the list moves to it.
    function exitFullscreen() {
        state.fullscreen = false;
        document.documentElement.classList.remove('video-full');
        closeChannelPanel();
        endInfoInteractive();
        document.getElementById('playerOverlay').classList.remove('visible');
        if (state.digitTimer) { clearTimeout(state.digitTimer); state.digitTimer = null; }
        state.digitBuffer = '';
        document.getElementById('numberEntry').hidden = true;

        // Opened from the TV Guide: back to it, on the channel that is playing.
        if (state.fullFrom === 'screen-guide' && state.guideList.length) {
            setTimeout(askAboutUpdate, 600);
            showScreen('screen-guide');
            var row = state.nowPlaying ? indexByUrl(state.guideList, state.nowPlaying.url) : -1;
            if (row !== -1) state.guideRow = row;
            markMenu();
            placeVideo();
            Focus.setZone('guideGrid', 0, 0);
            renderGuide();
            return;
        }

        setTimeout(askAboutUpdate, 600);   // an update that arrived while watching

        showScreen('screen-live');
        // Zapped to a channel outside the section that was showing: show them all.
        if (state.nowPlaying && indexByUrl(sectionChannels(state.section), state.nowPlaying.url) === -1) {
            state.section = { type: 'all' };
        }
        refreshLiveList(true);
        markMenu();
        placeVideo();
        focusLiveList();
    }

    // Stops the picture for good (leaving the Live TV screen).
    function stopPlayback() {
        if (state.previewTimer) { clearTimeout(state.previewTimer); state.previewTimer = null; }
        state.playToken = (state.playToken || 0) + 1;
        stopEngines();
        state.isPlaying = false;
        if (state.nowPlaying && state.watched) state.lastExited = state.nowPlaying;
        state.nowPlaying = null;
        state.watched = false;
        state.statusText = '';
        state.fullscreen = false;
        document.documentElement.classList.remove('video-full');
        document.getElementById('screen-player').classList.remove('preview');
    }

    function playPrevious() {
        var p = state.prevChannel;
        if (!p) { showToast('No previous channel yet'); return; }
        playChannel(p.ch, p.context, p.list, p.title);
    }

    function saveLastChannel(ch, context) {
        try {
            localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({
                url: ch.url, name: ch.name, group: ch.group, playlistId: ch.playlistId, context: context
            }));
        } catch (e) { /* non-fatal */ }
    }

    // Start of the app: put the list on the last watched channel, so its
    // preview starts. With "Open the last channel when the app starts" on, it
    // goes straight to full screen.
    function restoreLastChannel() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) || 'null'); } catch (e) { saved = null; }
        if (!saved || !saved.url || activeScreenId() !== 'screen-live') return;

        var section = null;
        if (saved.context === 'favorites' && indexByUrl(visibleFavorites(), saved.url) !== -1) {
            section = { type: 'favorites' };
        } else if (indexByUrl(state.channels, saved.url) !== -1) {
            section = { type: 'all' };
            for (var i = 0; i < state.categories.length; i++) {
                var cat = state.categories[i];
                if (cat.playlistId === saved.playlistId && cat.name === saved.group && indexByUrl(cat.channels, saved.url) !== -1) {
                    section = { type: 'category', index: i };
                    break;
                }
            }
        }
        if (!section) return;

        state.section = section;
        refreshLiveList(true);
        state.liveIndex = Math.max(0, indexByUrl(state.liveList, saved.url));
        markMenu();

        // The previous start put the list on this channel and never got as far
        // as a picture or a key press: do not start it again by itself.
        var pending = null;
        try { pending = localStorage.getItem(REOPEN_PENDING_KEY); } catch (e) { pending = null; }
        if (pending === '1') {
            reopenPending = true;
            clearReopenPending();
            logEvent('last channel not started: it did not start last time');
            renderLiveList();
            enterMenu();
            return;
        }
        try { localStorage.setItem(REOPEN_PENDING_KEY, '1'); reopenPending = true; } catch (e) { /* non-fatal */ }
        if (reopenLast) playChannel(state.liveList[state.liveIndex], sectionContext(section), state.liveList, sectionTitle(section));
        else focusLiveList();
    }

    // Set while the channel chosen at the start has not proved itself (a
    // picture for 5 s, or any key press).
    var reopenPending = false;
    function clearReopenPending() {
        if (!reopenPending) return;
        reopenPending = false;
        try { localStorage.removeItem(REOPEN_PENDING_KEY); } catch (e) { /* non-fatal */ }
    }

    function zapChannel(delta) {
        var list = state.zapList;
        if (!list || !list.length) return;
        var idx = Math.max(0, indexByUrl(list, state.nowPlaying.url));
        idx = (idx + delta + list.length) % list.length;
        playChannel(list[idx], state.zapContext, list, state.zapTitle);
    }

    // Playback strategy: on a Samsung TV, use the TV's built-in player first
    // (plain <video src>). It decodes HLS natively and is not subject to the
    // cross-origin (CORS) rules that hls.js's network requests are, which is
    // why other TV players can play streams that hls.js cannot. hls.js is the
    // second engine; off-TV (browser testing) the order is reversed. If an
    // engine errors or shows no video within PLAY_WATCHDOG_MS, the next one is tried.
    var PLAY_WATCHDOG_MS = 12000;
    // A stream the first player could not show rarely works in another one:
    // the fallbacks get less time, so a dead channel is given up on sooner.
    var FALLBACK_WATCHDOG_MS = 7000;
    var isTizen = !!(window.tizen);
    // Samsung's native player (AVPlay). Present only in an installed .wgt with
    // webapis.js loaded; not in a TizenBrew module or a desktop browser. It
    // fetches streams itself (no CORS) and decodes HLS natively, like other
    // Samsung IPTV apps, so it is the first choice whenever it exists.
    var hasAvplay = !!(window.webapis && window.webapis.avplay);
    var avplayObject = null;

    // Full screen only: in the preview window the status line under it says
    // the same, and moving through the list would raise one message per dead channel.
    function unavailableToast() {
        if (state.fullscreen) showToast('This channel is unavailable right now');
    }

    function setPlayerStatus(msg) {
        state.statusText = msg;
        document.getElementById('playerStatus').textContent = msg;
        if (!state.fullscreen) updateLiveInfo();
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
        showOverlayProgramme();
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
            // The reasons, player by player, are in the diagnostics list.
            clearReopenPending();
            markFailed(ch, true);
            if (!state.fullscreen) renderLiveList();
            logEvent('could not play "' + ch.name + '": ' + (state.playErrors.join(' | ') || 'no player available'));
            setPlayerStatus('Not available right now. The channel may be offline or blocked in your country.');
            unavailableToast();
            return;
        }
        state.engine = engine;
        var patience = state.playErrors.length ? FALLBACK_WATCHDOG_MS : PLAY_WATCHDOG_MS;
        state.watchdogId = setTimeout(function () {
            if (token !== state.playToken || state.isPlaying) return;
            engineFailed(token, engineLabel(engine) + ': no video after ' + (patience / 1000) + ' s');
        }, patience);

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
        // The channel to start on next time is the last one watched full screen.
        // Channels the list only passes over are neither saved nor logged.
        if (state.watched) saveLastChannel(state.nowPlaying, state.zapContext);
        if (failedChannels[state.nowPlaying.url]) {
            markFailed(state.nowPlaying, false);
            if (!state.fullscreen) renderLiveList();
        }
        if (state.fullscreen) logEvent('playing "' + state.nowPlaying.name + '" (' + engineLabel(state.engine) + ')');
        setTimeout(clearReopenPending, 5000);
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
        return state.quality ? 'Playing \u00b7 ' + state.quality : 'Playing';
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
        setPlayerStatus('The stream stopped.');
        showOverlay();
        unavailableToast();
    }

    function startAvplay(ch, token) {
        setPlayerStatus('Connecting\u2026');
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
            // The identity the playlist gives for this channel, if any. A favorite
            // saved before this existed takes it from its channel.
            var identity = ch.userAgent;
            if (identity === undefined) {
                var known = indexByUrl(state.channels, ch.url);
                identity = ch.userAgent = known === -1 ? '' : (state.channels[known].userAgent || '');
            }
            if (sendIdentity && identity) {
                try {
                    av.setStreamingProperty('USER_AGENT', identity);
                } catch (e) {
                    if (!identityFailureLogged) {
                        identityFailureLogged = true;
                        logEvent('playlist identity not accepted by the player: ' + ((e && e.name) || e));
                    }
                }
            }
            // Faster channel start (optional): show the picture after 2 s of
            // buffer, and resume after 3 s when it runs dry.
            if (fastStart) {
                try {
                    av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 2);
                    av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3);
                } catch (e) {
                    if (!fastStartFailureLogged) {
                        fastStartFailureLogged = true;
                        logEvent('faster channel start not supported: ' + ((e && e.name) || e));
                    }
                }
            }
            // Picture tuning (optional): adaptive streams start at the highest
            // quality the stream offers instead of the TV's default.
            if (pictureTuning) {
                try { av.setStreamingProperty('ADAPTIVE_INFO', 'STARTBITRATE=HIGHEST'); } catch (e) { /* single-quality stream */ }
            }
            av.setListener({
                onbufferingstart: function () {
                    if (token === state.playToken && state.isPlaying) setPlayerStatus('Buffering\u2026');
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
        // A channel the list only passes over gets one line at the end, not one per player.
        if (state.fullscreen) logEvent('failed: ' + reason);
        state.playErrors.push(reason);
        if (state.enginesLeft.length) setPlayerStatus('Trying another way to play\u2026');
        tryNextEngine(token);
    }

    function safePlay(token) {
        var p = videoPlayer.play();
        if (p && p.catch) p.catch(function (e) {
            if (token === state.playToken && !state.isPlaying && !state.playFailed) logEvent(engineLabel(state.engine) + ': play() refused (' + (e && e.name || 'error') + ')');
        });
    }

    function startNative(ch, token) {
        videoPlayer.src = ch.url;
        videoPlayer.load();
        safePlay(token);
    }

    function startHls(ch, token) {
        // Local reference: callbacks from an earlier attempt must not act on a newer one.
        var hls = new Hls({ backBufferLength: 30 });
        var networkRetries = 0;
        var mediaRecoveries = 0;
        state.hls = hls;
        hls.loadSource(ch.url);
        hls.attachMedia(videoPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (state.hls !== hls) return;
            setPlayerStatus('Starting\u2026');
            safePlay(token);
        });
        // A segment arriving means the stream is healthy again.
        hls.on(Hls.Events.FRAG_LOADED, function () { networkRetries = 0; });
        hls.on(Hls.Events.ERROR, function (event, data) {
            if (state.hls !== hls) return;
            if (!data.fatal) {
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
                logEvent('stream stopped: hls.js ' + data.details);
                setPlayerStatus('The stream stopped.');
                showOverlay();
                unavailableToast();
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
            logEvent('stream stopped: ' + reason);
            setPlayerStatus('The stream stopped.');
            showOverlay();
            unavailableToast();
        } else {
            engineFailed(state.playToken, reason);
        }
    });
    videoPlayer.addEventListener('waiting', function () {
        if (state.isPlaying) setPlayerStatus('Buffering\u2026');
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

    // Second line of the full-screen caption: the programme that is on, or
    // the channel's group when the guide has nothing.
    function showOverlayProgramme() {
        var ch = state.nowPlaying;
        if (!ch) return;
        var on = nowNext(ch);
        var text = ch.group || '';
        if (on && on.now) {
            text = String(on.now[2]) + ' \u00b7 ' + guideTime(on.now[0]) + ' \u2013 ' + guideTime(on.now[0] + on.now[1]);
            if (on.next) text += ' \u00b7 Next: ' + String(on.next[2]);
        }
        document.getElementById('nowPlayingGroup').textContent = text;
    }

    function showOverlay() {
        if (!state.fullscreen) return;   // the overlay belongs to the full-screen player
        showOverlayProgramme();
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
        var idx = state.nowPlaying ? indexByUrl(list, state.nowPlaying.url) : 0;
        state.panelIndex = idx < 0 ? 0 : idx;
        state.panelOpen = true;
        endInfoInteractive();
        document.getElementById('channelPanelTitle').textContent = state.zapTitle || 'Channels';
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
        var win = listWindow(state.panelIndex, list.length, PANEL_ROWS);
        var frag = document.createDocumentFragment();
        for (var i = win.start; i < win.end; i++) {
            frag.appendChild(buildChannelRow(list[i], i === state.panelIndex ? ' selected focused' : ''));
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
        if (ch) { playChannel(ch, state.zapContext, list, state.zapTitle); return; }
        for (var i = 0; i < state.categories.length; i++) {
            var found = state.categories[i].channels.find(function (c) { return c.number === n; });
            if (found) { playChannel(found, 'category', state.categories[i].channels, state.categories[i].name); return; }
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
                case KEYCODE.ENTER: playChannel(state.zapList[state.panelIndex], state.zapContext, state.zapList, state.zapTitle); break;
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
                else exitFullscreen();
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

    // The TV takes the video hardware away when the app goes to the background
    // (Home key, another app). Without this the picture stays black on return.
    document.addEventListener('visibilitychange', function () {
        if (!state.nowPlaying) return;
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
        if (!document.getElementById('updateNotice').hidden) { document.getElementById('updateLaterBtn').click(); return; }
        if (activeScreenId() === 'screen-add') { switchToScreen('screen-settings'); return; }
        if (activeScreenId() === 'screen-settings') { switchToScreen('screen-live'); return; }
        // TV Guide with the remote in the menu: back to Live TV.
        if (activeScreenId() === 'screen-guide') { switchToScreen('screen-live'); return; }
        // In Live TV's own menu: back to the main menu.
        if (Focus.currentZone === 'sideMenu' && state.menuMode === 'live') { closeLiveMenu(); return; }
        // Live TV with the remote in the main menu (Back in the list goes to the menu first).
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
        clearReopenPending();   // a key press: the app is alive and someone is using it

        var onPlayer = document.getElementById('screen-player').classList.contains('active');

        if (onPlayer) {
            var overlay = document.getElementById('playerOverlay');
            if (overlay.classList.contains('visible') && state.overlayTimeoutId) {
                clearTimeout(state.overlayTimeoutId);
                state.overlayTimeoutId = setTimeout(hideOverlayIfPlaying, OVERLAY_HIDE_MS);
            }
            handlePlayerKey(event.keyCode);
            return;
        }

        // The Live TV channel list and the TV Guide grid handle their own keys.
        if (Focus.currentZone === 'liveList') { handleLiveKey(event.keyCode); return; }
        if (Focus.currentZone === 'guideGrid') { handleGuideKey(event.keyCode); return; }

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
    logEvent('start ' + APP_VERSION + ' from ' + (window.MYTVAPP_SOURCE || 'own page') + ', Samsung player ' + (hasAvplay ? 'yes' : 'no'));
    Focus.setZone('sideMenu', 0, 0);

    // First run (or every playlist deleted): open the Playlists screen so the
    // one-press iptv-org presets are right there.
    refreshActiveChannels({ screen: state.playlists.length ? 'screen-live' : 'screen-settings', after: restoreLastChannel });
    setTimeout(checkForUpdate, UPDATE_CHECK_DELAY_MS);
    setTimeout(loadGuide, 1500);
});

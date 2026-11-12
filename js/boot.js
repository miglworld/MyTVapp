// MyTvApp start-up. Loaded by index.html, part of the installed package and
// never replaced by an update.
//
// The app normally runs from the package's own js/main.js. When the app has
// downloaded a newer version (see "Self-update" in js/main.js), that version
// is kept in storage and started from here instead: its stylesheet, its
// screens and its script, all from storage, nothing loaded over the network.
//
// Safety: an update that does not start is thrown away and never tried again,
// and the package's own version runs. The worst case is one failed start.
(function () {
    'use strict';
    var BUNDLED_VERSION = '0.11.10';

    var UPDATE_KEY = 'mytvapp_update';           // { version, js, css, html }
    var PENDING_KEY = 'mytvapp_update_pending';  // set while an update is being started
    var BAD_KEY = 'mytvapp_update_bad';          // version that failed to start
    var LOG_KEY = 'iptv_log';
    var CONFIRM_MS = 5000;

    window.MYTVAPP_BUNDLED = BUNDLED_VERSION;

    function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* non-fatal */ } }
    function remove(key) { try { localStorage.removeItem(key); } catch (e) { /* non-fatal */ } }

    // Same diagnostics list as js/main.js (bottom of Settings).
    function log(msg) {
        try {
            var d = new Date();
            var two = function (n) { return (n < 10 ? '0' : '') + n; };
            var lines = JSON.parse(get(LOG_KEY) || '[]') || [];
            lines.push(two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + msg);
            if (lines.length > 14) lines = lines.slice(lines.length - 14);
            set(LOG_KEY, JSON.stringify(lines));
        } catch (e) { /* non-fatal */ }
    }

    // true when version a is higher than b ("0.10.0" > "0.9.2").
    function newer(a, b) {
        var x = String(a).split('.'), y = String(b).split('.');
        for (var i = 0; i < 3; i++) {
            var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0;
            if (p !== q) return p > q;
        }
        return false;
    }

    function startBundled() {
        var s = document.createElement('script');
        s.src = 'js/main.js';
        s.onerror = function () { if (window.MYTVAPP_ERROR) window.MYTVAPP_ERROR('could not load js/main.js'); };
        document.body.appendChild(s);
    }

    function dropUpdate(markBad) {
        if (markBad) set(BAD_KEY, markBad);
        remove(UPDATE_KEY);
        remove(PENDING_KEY);
    }

    // Updates are for the installed app. A web page or TizenBrew module is
    // already served from the network (localhost is allowed for testing).
    var installed = location.protocol.indexOf('http') !== 0 || location.hostname === 'localhost';

    var upd = null;
    try { upd = JSON.parse(get(UPDATE_KEY) || 'null'); } catch (e) { upd = null; }

    if (!upd || !installed) { startBundled(); return; }

    // A newer package was installed since the download, or the entry is broken.
    if (!upd.version || !upd.js || !newer(upd.version, BUNDLED_VERSION)) {
        dropUpdate(null);
        startBundled();
        return;
    }

    // The previous start tried this update and never confirmed it.
    if (get(PENDING_KEY) === '1') {
        dropUpdate(upd.version);
        log('update ' + upd.version + ' removed: it did not start last time');
        startBundled();
        return;
    }

    set(PENDING_KEY, '1');
    try {
        if (upd.css) {
            var old = document.querySelector('link[rel="stylesheet"]');
            var style = document.createElement('style');
            style.textContent = upd.css;
            document.head.appendChild(style);
            if (old && old.parentNode) old.parentNode.removeChild(old);
        }
        if (upd.html) document.getElementById('app').innerHTML = upd.html;
        window.MYTVAPP_SOURCE = 'downloaded update';
        var script = document.createElement('script');
        script.text = upd.js;
        document.body.appendChild(script);   // runs right away
    } catch (e) {
        log('update ' + upd.version + ' failed: ' + ((e && e.message) || e));
    }

    if (!window.MYTVAPP_STARTED) {
        // Throw it away and start again from the package's own files.
        dropUpdate(upd.version);
        log('update ' + upd.version + ' removed: it did not start');
        location.reload();
        return;
    }

    // Still running after a few seconds: the update is good.
    setTimeout(function () { remove(PENDING_KEY); }, CONFIRM_MS);
})();

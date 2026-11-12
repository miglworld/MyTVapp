// Tests for the parts of js/main.js that do not need a page.
// Run with: node scripts/test.js
'use strict';
var assert = require('assert');
var path = require('path');
var app = require(path.join(__dirname, '..', 'js', 'main.js'));

var passed = 0;
function test(name, fn) {
    try { fn(); passed++; } catch (e) {
        console.error('FAIL: ' + name + '\n  ' + e.message);
        process.exitCode = 1;
    }
}

test('main.js hands out its functions under Node', function () {
    assert.strictEqual(typeof app.parseM3U, 'function');
    assert.strictEqual(typeof app.versionNewer, 'function');
});

test('parses a simple playlist', function () {
    var ch = app.parseM3U([
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="rtp1.pt" tvg-logo="http://x/l.png" group-title="General",RTP 1',
        'http://example.com/rtp1.m3u8'
    ].join('\n'));
    assert.strictEqual(ch.length, 1);
    assert.strictEqual(ch[0].name, 'RTP 1');
    assert.strictEqual(ch[0].group, 'General');
    assert.strictEqual(ch[0].logo, 'http://x/l.png');
    assert.strictEqual(ch[0].tvgId, 'rtp1.pt');
    assert.strictEqual(ch[0].url, 'http://example.com/rtp1.m3u8');
});

test('a comma inside an attribute is not the start of the name', function () {
    var ch = app.parseM3U('#EXTINF:-1 group-title="News, Sport" tvg-id="a",Channel, One\nhttp://e/1');
    assert.strictEqual(ch[0].group, 'News, Sport');
    assert.strictEqual(ch[0].name, 'Channel, One');
});

test('Windows line endings and blank lines', function () {
    var ch = app.parseM3U('#EXTM3U\r\n\r\n#EXTINF:-1,A\r\nhttp://e/a\r\n\r\n#EXTINF:-1,B\r\nhttp://e/b\r\n');
    assert.deepStrictEqual(ch.map(function (c) { return c.name + '|' + c.url; }), ['A|http://e/a', 'B|http://e/b']);
});

test('defaults: group "Other", unnamed channel', function () {
    var ch = app.parseM3U('#EXTINF:-1,\nhttp://e/a');
    assert.strictEqual(ch[0].group, 'Other');
    assert.strictEqual(ch[0].name, 'Unnamed Channel');
});

test('#EXTGRP gives the group when group-title is missing', function () {
    var ch = app.parseM3U('#EXTINF:-1,A\n#EXTGRP:Movies\nhttp://e/a\n#EXTINF:-1 group-title="Kids",B\n#EXTGRP:Movies\nhttp://e/b');
    assert.strictEqual(ch[0].group, 'Movies');
    assert.strictEqual(ch[1].group, 'Kids');
});

test('other # lines between the entry and its URL are skipped', function () {
    var ch = app.parseM3U('#EXTINF:-1,A\n#EXTVLCOPT:http-user-agent=X\nhttp://e/a');
    assert.strictEqual(ch.length, 1);
    assert.strictEqual(ch[0].url, 'http://e/a');
});

test('a URL without an entry, and an entry without a URL, give no channel', function () {
    assert.strictEqual(app.parseM3U('http://e/orphan').length, 0);
    assert.strictEqual(app.parseM3U('#EXTINF:-1,A').length, 0);
});

test('only real stream addresses become channels', function () {
    var ch = app.parseM3U([
        '#EXTINF:-1,ok http', 'http://e/a',
        '#EXTINF:-1,ok https', 'HTTPS://e/b',
        '#EXTINF:-1,ok rtmp', 'rtmp://e/live',
        '#EXTINF:-1,ok udp', 'udp://@239.0.0.1:1234',
        '#EXTINF:-1,file', 'file:///etc/passwd',
        '#EXTINF:-1,script', 'javascript:alert(1)',
        '#EXTINF:-1,data', 'data:text/html,<script>alert(1)</script>',
        '#EXTINF:-1,relative', '../../index.html',
        '#EXTINF:-1,spaces', 'http://e/a b'
    ].join('\n'));
    assert.deepStrictEqual(ch.map(function (c) { return c.name; }), ['ok http', 'ok https', 'ok rtmp', 'ok udp']);
});

test('a rejected address does not attach its entry to the next URL', function () {
    var ch = app.parseM3U('#EXTINF:-1,bad\nfile:///x\nhttp://e/stray\n#EXTINF:-1,good\nhttp://e/g');
    assert.deepStrictEqual(ch.map(function (c) { return c.name + '|' + c.url; }), ['good|http://e/g']);
});

test('logos must be web addresses', function () {
    var ch = app.parseM3U([
        '#EXTINF:-1 tvg-logo="https://e/l.png",a', 'http://e/a',
        '#EXTINF:-1 tvg-logo="javascript:alert(1)",b', 'http://e/b',
        '#EXTINF:-1 tvg-logo="file:///x.png",c', 'http://e/c',
        '#EXTINF:-1 tvg-logo="x) ; background: red",d', 'http://e/d'
    ].join('\n'));
    assert.deepStrictEqual(ch.map(function (c) { return c.logo; }), ['https://e/l.png', '', '', '']);
});

test('markup in names stays plain text for the page to show as text', function () {
    var ch = app.parseM3U('#EXTINF:-1 group-title="<img src=x onerror=alert(1)>",<script>alert(1)</script>\nhttp://e/a');
    assert.strictEqual(ch[0].name, '<script>alert(1)</script>');
    assert.strictEqual(ch[0].group, '<img src=x onerror=alert(1)>');
});

test('the identity a playlist gives for a channel', function () {
    var ch = app.parseM3U([
        '#EXTINF:-1 tvg-id="a",From an option line',
        '#EXTVLCOPT:http-referrer=https://example.com/',
        '#EXTVLCOPT:http-user-agent=Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0',
        'http://e/a',
        '#EXTINF:-1 user-agent="Mozilla/5.0 (KHTML, like Gecko) Chrome/149.0.0.0" group-title="Sports",From an attribute',
        'http://e/b',
        '#EXTINF:-1,None',
        'http://e/c'
    ].join('\n'));
    assert.strictEqual(ch[0].userAgent, 'Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0');
    assert.strictEqual(ch[1].userAgent, 'Mozilla/5.0 (KHTML, like Gecko) Chrome/149.0.0.0');
    assert.strictEqual(ch[1].name, 'From an attribute');
    assert.strictEqual(ch[1].group, 'Sports');
    assert.strictEqual(ch[2].userAgent, '');
    // An option line belongs to the entry above it only.
    assert.strictEqual(app.parseM3U('#EXTVLCOPT:http-user-agent=X\n#EXTINF:-1,A\nhttp://e/a')[0].userAgent, '');
});

test('an identity cannot smuggle in line breaks or be endless', function () {
    assert.strictEqual(app.cleanUserAgent('Agent\r\nCookie: stolen=1'), 'AgentCookie: stolen=1');
    assert.strictEqual(app.cleanUserAgent('  Mozilla/5.0  '), 'Mozilla/5.0');
    assert.strictEqual(app.cleanUserAgent(new Array(400).join('x')), '');
    assert.strictEqual(app.cleanUserAgent(undefined), '');
});

test('the rows a long list builds stay around the selected one', function () {
    assert.deepStrictEqual(app.listWindow(0, 100, 10), { start: 0, end: 10 });
    assert.deepStrictEqual(app.listWindow(50, 100, 10), { start: 45, end: 55 });
    assert.deepStrictEqual(app.listWindow(99, 100, 10), { start: 90, end: 100 });
    assert.deepStrictEqual(app.listWindow(2, 3, 10), { start: 0, end: 3 });
    assert.deepStrictEqual(app.listWindow(0, 0, 10), { start: 0, end: 0 });
});

test('the programme at a given minute', function () {
    var list = [[100, 30, 'A'], [130, 60, 'B'], [200, 10, 'C']];   // a gap from 190 to 200
    assert.strictEqual(app.guideIndexAt(list, 100), 0);
    assert.strictEqual(app.guideIndexAt(list, 129.9), 0);
    assert.strictEqual(app.guideIndexAt(list, 130), 1);
    assert.strictEqual(app.guideIndexAt(list, 195), 2);    // in the gap: the next one
    assert.strictEqual(app.guideIndexAt(list, 50), 0);     // before everything: the first
    assert.strictEqual(app.guideIndexAt(list, 999), 2);    // after everything: the last
    assert.strictEqual(app.guideIndexAt([], 100), -1);
});

test('channels a playlist marks as unreliable', function () {
    assert.strictEqual(app.isTagged({ name: 'SIC (1080p) [Geo-blocked]' }), true);
    assert.strictEqual(app.isTagged({ name: 'RTP 1 (720p) [Not 24/7]' }), true);
    assert.strictEqual(app.isTagged({ name: 'rtp [not 24/7]' }), true);
    assert.strictEqual(app.isTagged({ name: 'TVI (720p)' }), false);
    assert.strictEqual(app.isTagged({}), false);
});

test('how long ago, in words', function () {
    var now = Date.now();
    assert.strictEqual(app.ago(0), 'not yet');
    assert.strictEqual(app.ago(now - 30 * 1000), 'just now');
    assert.strictEqual(app.ago(now - 45 * 60 * 1000), '45 minutes ago');
    assert.strictEqual(app.ago(now - 3 * 3600 * 1000), '3 hours ago');
    assert.strictEqual(app.ago(now - 4 * 24 * 3600 * 1000), '4 days ago');
});

test('channel number attribute is kept', function () {
    assert.strictEqual(app.parseM3U('#EXTINF:-1 tvg-chno="12",A\nhttp://e/a')[0].chno, '12');
});

test('version comparison is by number, not by text', function () {
    assert.strictEqual(app.versionNewer('0.10.0', '0.9.2'), true);
    assert.strictEqual(app.versionNewer('0.9.2', '0.10.0'), false);
    assert.strictEqual(app.versionNewer('1.0.0', '0.99.99'), true);
    assert.strictEqual(app.versionNewer('0.9.1', '0.9.1'), false);
    assert.strictEqual(app.versionNewer('0.9', '0.9.0'), false);
    assert.strictEqual(app.versionNewer('', '0.9.0'), false);
});

if (!process.exitCode) console.log(passed + ' tests passed');

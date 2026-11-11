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

// Tests for scripts/build-guide.js. Run with: node scripts/test-guide.js
'use strict';
var assert = require('assert');
var guide = require('./build-guide.js');

var passed = 0;
function test(name, fn) {
    try { fn(); passed++; } catch (e) {
        console.error('FAIL: ' + name + '\n  ' + e.message);
        process.exitCode = 1;
    }
}

var NOW = Date.UTC(2026, 10, 12, 12, 0, 0) / 1000;   // 12 Nov 2026, 12:00 UTC

test('channel key: no "@" ending, lower case', function () {
    assert.strictEqual(guide.channelKey('RTP1.pt@SD'), 'rtp1.pt');
    assert.strictEqual(guide.channelKey('AXNWhite.us@Portugal'), 'axnwhite.us');
    assert.strictEqual(guide.channelKey(''), '');
});

test('playlist keys', function () {
    var keys = guide.playlistKeys('#EXTINF:-1 tvg-id="RTP1.pt@SD",RTP 1\nhttp://e/a\n#EXTINF:-1 tvg-id="",none\nhttp://e/b\n#EXTINF:-1 tvg-id="SIC.pt",SIC\nhttp://e/c');
    assert.deepStrictEqual(Object.keys(keys).sort(), ['rtp1.pt', 'sic.pt']);
});

test('XMLTV times, with and without an offset', function () {
    assert.strictEqual(guide.parseXmltvTime('20261112120000 +0000'), NOW);
    assert.strictEqual(guide.parseXmltvTime('20261112130000 +0100'), NOW);
    assert.strictEqual(guide.parseXmltvTime('20261112070000 -0500'), NOW);
    assert.strictEqual(guide.parseXmltvTime('20261112120000'), NOW);
    assert.ok(isNaN(guide.parseXmltvTime('soon')));
});

var XML = [
    '<tv>',
    '<channel id="RTP1.pt"><display-name>RTP 1</display-name></channel>',
    '<programme start="20261112115800 +0000" stop="20261112132500 +0000" channel="RTP1.pt">',
    '  <title lang="pt">Jornal da Tarde</title><desc lang="pt">Not&#237;cias &amp; desporto</desc>',
    '  <icon src="https://example.com/a.png" /></programme>',
    '<programme start="20261112132500 +0000" stop="20261112140000 +0000" channel="RTP1.pt"><title>Hora da Sorte</title></programme>',
    '<programme start="20261112132500 +0000" stop="20261112140000 +0000" channel="RTP1.pt"><title>Hora da Sorte (repeat)</title></programme>',
    '<programme start="20261111060000 +0000" stop="20261111070000 +0000" channel="RTP1.pt"><title>Yesterday</title></programme>',
    '<programme start="20261120060000 +0000" stop="20261120070000 +0000" channel="RTP1.pt"><title>Next week</title></programme>',
    '<programme start="20261112120000 +0000" stop="20261112130000 +0000" channel="Other.pt"><title>Not wanted</title></programme>',
    '<programme start="20261112140000 +0000" stop="20261112140000 +0000" channel="RTP1.pt"><title>No length</title></programme>',
    '<programme start="20261112150000 +0000" stop="20261112160000 +0000" channel="RTP1.pt"><desc>No title</desc></programme>',
    '</tv>'
].join('\n');

test('keeps wanted channels inside the time window, tidied', function () {
    var channels = {};
    guide.addProgrammes(channels, XML, { 'rtp1.pt': true }, NOW, 48);
    guide.tidy(channels);
    assert.deepStrictEqual(Object.keys(channels), ['rtp1.pt']);
    var list = channels['rtp1.pt'];
    assert.deepStrictEqual(list.map(function (e) { return e[2]; }), ['Jornal da Tarde', 'Hora da Sorte']);
    assert.strictEqual(list[0][0], (NOW - 120) / 60);      // start, in minutes
    assert.strictEqual(list[0][1], 87);                    // length, in minutes
    assert.strictEqual(list[0][3], 'Notícias & desporto');
    assert.strictEqual(list[1].length, 3);                 // no description: no fourth field
});

test('long descriptions are cut', function () {
    var long = new Array(60).join('palavra ');
    var channels = {};
    guide.addProgrammes(channels, '<programme start="20261112120000 +0000" stop="20261112130000 +0000" channel="A.pt"><title>T</title><desc>' + long + '</desc></programme>', { 'a.pt': true }, NOW, 48);
    assert.ok(channels['a.pt'][0][3].length <= 200);
    assert.strictEqual(channels['a.pt'][0][3].slice(-1), '…');
});

if (!process.exitCode) console.log(passed + ' guide tests passed');

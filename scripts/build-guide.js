#!/usr/bin/env node
// Builds the small programme guide the TV downloads.
//
// A full XMLTV guide for one country is tens of MB: every channel, a week of
// programmes, long descriptions, artwork. A TV cannot download and read that
// at every start. This script keeps only the channels that are in the
// playlists listed in guide/config.json and only the next hours, and writes
// them as compact JSON:
//
//   { "generated": <seconds since 1970>, "hours": 48,
//     "channels": { "rtp1.pt": [[<start, minutes since 1970>, <length, minutes>, "Title", "Description"], ...] } }
//
// Channels are matched by the playlist's tvg-id without its "@..." ending,
// in lower case ("RTP1.pt@SD" -> "rtp1.pt"), which is how the guide names them.
//
// Run by .github/workflows/guide.yml on a schedule; by hand:
//   node scripts/build-guide.js out/guide.json
'use strict';
var fs = require('fs');
var path = require('path');

var DESCRIPTION_MAX = 200;
var PAST_HOURS = 3;   // keep what started a little while ago: it may still be on

function decodeXml(s) {
    return String(s)
        .replace(/&#(\d+);/g, function (m, n) { return String.fromCodePoint(Number(n)); })
        .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCodePoint(parseInt(n, 16)); })
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

// "RTP1.pt@SD" -> "rtp1.pt"
function channelKey(tvgId) {
    return String(tvgId || '').split('@')[0].trim().toLowerCase();
}

// The channel keys a playlist asks for.
function playlistKeys(m3u) {
    var keys = {};
    var re = /tvg-id="([^"]*)"/g;
    var m;
    while ((m = re.exec(m3u)) !== null) {
        var key = channelKey(m[1]);
        if (key) keys[key] = true;
    }
    return keys;
}

// "20261112125800 +0000" -> seconds since 1970, or NaN.
function parseXmltvTime(text) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(text || '').trim());
    if (!m) return NaN;
    var seconds = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
    if (m[7]) {
        var sign = m[7].charAt(0) === '-' ? -1 : 1;
        seconds -= sign * (parseInt(m[7].slice(1, 3), 10) * 3600 + parseInt(m[7].slice(3, 5), 10) * 60);
    }
    return seconds;
}

function attribute(attrs, name) {
    var m = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs);
    return m ? m[1] : '';
}

function element(body, name) {
    var m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(body);
    return m ? decodeXml(m[1]).replace(/\s+/g, ' ').trim() : '';
}

// Adds the wanted programmes of one XMLTV text to `channels`.
// wanted: { key: true }; nowSeconds: the present; hours: how far ahead to keep.
function addProgrammes(channels, xml, wanted, nowSeconds, hours) {
    var from = nowSeconds - PAST_HOURS * 3600;
    var until = nowSeconds + hours * 3600;
    var re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    var m;
    var added = 0;
    while ((m = re.exec(xml)) !== null) {
        var key = channelKey(decodeXml(attribute(m[1], 'channel')));
        if (!wanted[key]) continue;
        var start = parseXmltvTime(attribute(m[1], 'start'));
        var stop = parseXmltvTime(attribute(m[1], 'stop'));
        if (!(stop > start) || stop <= from || start >= until) continue;
        var title = element(m[2], 'title');
        if (!title) continue;
        var entry = [Math.round(start / 60), Math.round((stop - start) / 60), title];
        var description = element(m[2], 'desc');
        if (description && description !== title) {
            entry.push(description.length > DESCRIPTION_MAX ? description.slice(0, DESCRIPTION_MAX - 1).trim() + '…' : description);
        }
        if (!channels[key]) channels[key] = [];
        channels[key].push(entry);
        added++;
    }
    return added;
}

// In order of start, without programmes that start at the same minute twice
// (two feeds, or a feed that repeats itself).
function tidy(channels) {
    Object.keys(channels).forEach(function (key) {
        var seen = {};
        channels[key] = channels[key]
            .sort(function (a, b) { return a[0] - b[0]; })
            .filter(function (e) { if (seen[e[0]]) return false; seen[e[0]] = true; return true; });
    });
    return channels;
}

function download(url) {
    return fetch(url, { redirect: 'follow' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
        return res.text();
    });
}

function main() {
    var out = process.argv[2] || 'guide.json';
    var config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'guide', 'config.json'), 'utf8'));
    var hours = config.hours || 48;
    var now = Math.floor(Date.now() / 1000);
    var wanted = {};
    var channels = {};

    return Promise.all(config.playlists.map(download)).then(function (playlists) {
        playlists.forEach(function (m3u) { Object.assign(wanted, playlistKeys(m3u)); });
        console.log('channels in the playlists: ' + Object.keys(wanted).length);
        // One feed after another: each is large.
        return config.feeds.reduce(function (chain, url) {
            return chain.then(function () { return download(url); }).then(function (xml) {
                var added = addProgrammes(channels, xml, wanted, now, hours);
                console.log(url + ': ' + (xml.length / 1e6).toFixed(1) + ' MB, ' + added + ' programmes kept');
            });
        }, Promise.resolve());
    }).then(function () {
        tidy(channels);
        var total = Object.keys(channels).reduce(function (n, k) { return n + channels[k].length; }, 0);
        // An empty guide means a feed is broken or has changed: fail, so the
        // guide that is already published stays as it is.
        if (!total) throw new Error('no programmes found for any channel');
        var json = JSON.stringify({ generated: now, hours: hours, channels: channels });
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(out, json);
        console.log('wrote ' + out + ': ' + Object.keys(channels).length + ' channels, ' + total + ' programmes, ' +
            Math.round(Buffer.byteLength(json) / 1024) + ' KB');
    });
}

module.exports = { channelKey: channelKey, playlistKeys: playlistKeys, parseXmltvTime: parseXmltvTime, addProgrammes: addProgrammes, tidy: tidy };

if (require.main === module) {
    main().catch(function (err) { console.error('guide not built: ' + err.message); process.exit(1); });
}

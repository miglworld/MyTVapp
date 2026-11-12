# Builds the demo setup the README screenshots are taken from: invented
# channels, their logos, an invented programme guide and a copy of the app
# page that uses them. Run from the repository root.
import os, json, re
ROOT='.'
os.makedirs('_shots/logos', exist_ok=True)

CHANNELS = [
 ('News','Aurora News','#2f6fed'),('News','Meridian 24','#0f9d8a'),('News','Harbor Business','#c9772b'),
 ('Sports','Atlas Sport 1','#e0453a'),('Sports','Atlas Sport 2','#b5362e'),('Sports','Summit Racing','#d8a215'),
 ('Movies','Cinema Nova','#7a4dd8'),('Movies','Lantern Classics','#9c6b3f'),('Movies','Midnight Feature','#3d4a8f'),
 ('Kids','Kids Planet','#22a55a'),('Kids','Tiny Tales','#e06aa6'),
 ('Music','Pulse Hits','#d43f8d'),('Music','Blue Note Live','#2a7fb8'),
 ('Documentary','Terra Wild','#3f8f4b'),('Documentary','Orbit Science','#4b63c9'),('Documentary','History Lane','#8a6d3b'),
 ('Entertainment','Canal Uno','#e2572b'),('Entertainment','Studio 5','#5b6cff'),('Entertainment','Comedy Corner','#c9a227'),
 ('Lifestyle','Garden & Home','#5a9e3c'),('Lifestyle','Taste Kitchen','#d2603a'),
]
SHOWS = {
 'News': ['Morning Briefing','World Report','The Midday Desk','Business Hour','Evening Edition','Night Line','Weather Outlook','In Depth'],
 'Sports': ['Matchday Live','Championship Highlights','The Final Whistle','Grand Prix Qualifying','Courtside','Sports Tonight','Classic Matches','Transfer Talk'],
 'Movies': ['The Long Harbor','A Winter in Lisbon','Paper Lanterns','North of the River','The Quiet Detective','Last Train Home','Starlight Hotel','Second Summer'],
 'Kids': ['Captain Bubble','The Tiny Explorers','Paint Pals','Robo & Friends','Story Tree','Jungle Jam','Space Pups','Bedtime Tales'],
 'Music': ['Top 40 Countdown','Live at the Loft','Acoustic Sessions','Night Jazz','New Releases','Decades Mix','Unplugged','Festival Stage'],
 'Documentary': ['Oceans Apart','The Wandering Herd','Inside the Volcano','Engineering Giants','Lost Cities','Planet Night','The Ice Road','Wings'],
 'Entertainment': ['The Big Quiz','Kitchen Rivals','Tonight with Mara','Street Stories','Talent Night','The Morning Table','Family Matters','Late Laughs'],
 'Lifestyle': ['Garden Rescue','Small Spaces','Sunday Roast','Market Day','Home Makers','The Balcony Farmer','Bake Off Stories','Weekend Away'],
}
DESCS = {
 'News': 'The day’s main stories from home and abroad, with live reports and analysis.',
 'Sports': 'Live coverage with studio guests, expert commentary and all the key moments.',
 'Movies': 'A feature film from the channel’s collection, shown without interruption.',
 'Kids': 'Songs, stories and adventures for younger viewers.',
 'Music': 'An hour of performances and videos picked by the channel’s presenters.',
 'Documentary': 'A journey to places few people see, told by the people who know them best.',
 'Entertainment': 'Guests, games and conversation in front of a studio audience.',
 'Lifestyle': 'Ideas and inspiration for home, garden and table.',
}
def slug(n): return re.sub(r'[^A-Za-z0-9]','',n)
def initials(n):
    w=[x for x in re.split(r'[^A-Za-z0-9]+',n) if x]
    return (w[0][0]+(w[1][0] if len(w)>1 else '')).upper()

lines=['#EXTM3U']
meta=[]
for i,(group,name,color) in enumerate(CHANNELS):
    s=slug(name)
    svg=('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 88"><rect width="132" height="88" rx="14" fill="%s"/>'
         '<text x="66" y="57" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="700" fill="#ffffff">%s</text></svg>') % (color, initials(name))
    open('_shots/logos/%s.svg'%s,'w').write(svg)
    lines.append('#EXTINF:-1 tvg-id="%s.demo" tvg-logo="http://localhost:8765/_shots/logos/%s.svg" group-title="%s",%s' % (s,s,group,name))
    lines.append('https://stream.example.invalid/%s/index.m3u8' % s.lower())
    meta.append({'key':(s+'.demo').lower(),'group':group,'shows':SHOWS[group],'desc':DESCS[group],'offset':i})
open('_shots/demo.m3u','w').write('\n'.join(lines)+'\n')

PICTURE = '''<svg id="fakePicture" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a5c"/><stop offset="0.45" stop-color="#c45a7a"/><stop offset="0.72" stop-color="#f6a35c"/><stop offset="1" stop-color="#fbd08a"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d8"/><stop offset="0.35" stop-color="#ffd98a"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e88f62"/><stop offset="1" stop-color="#2a2550"/></linearGradient>
</defs>
<rect width="1920" height="1080" fill="url(#sky)"/>
<circle cx="1290" cy="640" r="330" fill="url(#sun)"/>
<circle cx="1290" cy="640" r="92" fill="#fff3cf"/>
<path d="M0 700 L220 560 L420 650 L640 500 L860 640 L1040 570 L1240 680 L1460 590 L1700 670 L1920 600 L1920 760 L0 760Z" fill="#6b3f6e"/>
<path d="M0 760 L300 640 L520 720 L760 610 L980 720 L1220 650 L1500 730 L1740 660 L1920 720 L1920 800 L0 800Z" fill="#45305f"/>
<rect y="780" width="1920" height="300" fill="url(#water)"/>
<path d="M1160 800 h260 M1120 840 h340 M1180 880 h220 M1140 930 h300 M1200 980 h180" stroke="#ffe2a8" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
<path d="M0 1080 L0 900 Q240 860 420 930 T900 950 T1500 990 T1920 940 L1920 1080Z" fill="#17142e"/>
</svg>'''

INJECT = '''<style>
#fakePicture { position: fixed; top: 0; left: 0; width: 1920px; height: 1080px; z-index: -1; }
/* The off-screen web view pauses animations: show end states at once. */
* { transition: none !important; animation: none !important; }
</style>
<script>
// ---- demo setup for screenshots: nothing here is part of the app ----
(function () {
    var CH = %(meta)s;
    localStorage.setItem('iptv_playlists', JSON.stringify([{ id: 'demo', name: 'Demo TV', url: 'https://example.com/playlists/demo.m3u' }]));
    localStorage.setItem('iptv_active_playlist_id', JSON.stringify(['demo']));
    localStorage.setItem('iptv_auto_update', '1');

    // A Samsung player that always plays.
    window.webapis = { avplay: (function () {
        var L = null, t = null;
        return { open: function () {}, setDisplayRect: function () {}, setListener: function (x) { L = x; },
            setStreamingProperty: function () {}, setBufferingParam: function () {}, setDisplayMethod: function () {},
            prepareAsync: function (ok) { setTimeout(ok, 120); },
            play: function () { clearInterval(t); t = setInterval(function () { if (L) L.oncurrentplaytime(1); }, 250); },
            stop: function () { clearInterval(t); }, close: function () {}, getState: function () { return 'PLAYING'; }, pause: function () {},
            getCurrentStreamInfo: function () { return [{ type: 'VIDEO', extra_info: JSON.stringify({ Width: '1920', Height: '1080', Bit_rate: '6200000' }) }]; },
            getStreamingProperty: function () { return '0'; } };
    })() };

    // An invented programme guide around the present.
    function guide() {
        var now = Math.floor(Date.now() / 60000);
        var start = Math.floor(now / 60) * 60 - 120;
        var lens = [30, 60, 45, 90, 30, 60, 120, 45];
        var channels = {};
        CH.forEach(function (c) {
            var t = start - (c.offset %% 3) * 15, list = [], i = c.offset;
            while (t < start + 14 * 60) {
                var len = lens[(i + c.offset) %% lens.length];
                list.push([t, len, c.shows[i %% c.shows.length], c.desc]);
                t += len; i++;
            }
            channels[c.key] = list;
        });
        return JSON.stringify({ generated: Math.floor(Date.now() / 1000) - 1800, hours: 48, channels: channels });
    }
    var realFetch = window.fetch;
    window.fetch = function (url, options) {
        url = String(url);
        if (url.indexOf('example.com/playlists/demo.m3u') !== -1) return realFetch('_shots/demo.m3u', options);
        if (url.indexOf('guide.json') !== -1) return Promise.resolve(new Response(guide(), { status: 200 }));
        if (url.indexOf('api.github.com') !== -1 || url.indexOf('raw.githubusercontent.com') !== -1) return Promise.reject(new Error('offline in the demo'));
        return realFetch(url, options);
    };

    // ---- scenes ----
    var KEY = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009 };
    function press(name, times) {
        for (var i = 0; i < (times || 1); i++) {
            document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: KEY[name], which: KEY[name], bubbles: true, cancelable: true }));
        }
    }
    function later(ms, fn) { return new Promise(function (r) { setTimeout(function () { fn(); r(); }, ms); }); }
    var scene = (location.search.match(/scene=([a-z-]+)/) || [])[1] || 'live';
    var SCENES = {
        'live': function () { return later(0, function () { press('down', 6); }); },
        'menu': function () { return later(0, function () { press('down', 6); }).then(function () { return later(1200, function () { press('left'); }); }).then(function () { return later(300, function () { press('down', 3); }); }); },
        'guide': function () { return later(0, function () { press('down', 6); }).then(function () { return later(1200, function () { press('left'); press('left'); press('down'); press('ok'); }); }).then(function () { return later(400, function () { press('down', 2); press('right'); }); }); },
        'full': function () { return later(0, function () { press('down', 6); }).then(function () { return later(1200, function () { press('ok'); }); }).then(function () { return later(500, function () { press('right'); }); }); },
        'full-list': function () { return later(0, function () { press('down', 6); }).then(function () { return later(1200, function () { press('ok'); }); }).then(function () { return later(500, function () { press('ok'); press('down', 2); }); }); },
        'settings': function () { return later(0, function () { press('left'); press('left'); press('down', 3); press('ok'); }).then(function () { return later(400, function () { press('right'); }); }); },
        'settings-playback': function () { return later(0, function () { press('left'); press('left'); press('down', 3); press('ok'); }).then(function () { return later(400, function () { press('down'); press('right'); press('down'); }); }); },
        'settings-about': function () { return later(0, function () { press('left'); press('left'); press('down', 3); press('ok'); }).then(function () { return later(400, function () { press('down', 4); }); }); },
        'notice': function () { return later(0, function () { press('down', 6); }).then(function () { return later(1200, function () {
            document.getElementById('updateNoticeText').textContent = 'MyTvApp 0.13.0 is ready to install.';
            document.getElementById('updateNotice').hidden = false;
            var f = document.querySelectorAll('.focused'); for (var i = 0; i < f.length; i++) f[i].classList.remove('focused');
            document.getElementById('updateNowBtn').classList.add('focused');
        }); }); }
    };
    window.addEventListener('load', function () {
        setTimeout(function () { (SCENES[scene] || SCENES.live)(); }, 2600);
    });
})();
</script>
'''
html=open('index.html',encoding='utf-8').read()
html=html.replace('<script type="text/javascript" src="$WEBAPIS/webapis/webapis.js"></script>', INJECT % {'meta': json.dumps(meta)},1)
assert 'demo setup for screenshots' in html
html=html.replace('<body>','<body>\n'+PICTURE,1)
open('_shot.html','w',encoding='utf-8').write(html)
print('channels', len(CHANNELS))

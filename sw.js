const VERSION = 'v202611281644';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open('dr-shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('dr-shell-') && k !== 'dr-shell-' + VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 音频：优先用离线缓存（地铁里也能听），Range 请求交给浏览器
  if (u.pathname.includes('/audio/')) {
    e.respondWith(caches.open('dr-audio').then(async c => {
      const hit = await c.match(u.pathname.replace(/^.*\/audio\//, 'audio/')) || await c.match(e.request.url.split('?')[0]);
      if (hit && !e.request.headers.get('range')) return hit;
      if (hit && e.request.headers.get('range')) {
        const buf = await hit.arrayBuffer(); const m = /bytes=(\d+)-(\d*)/.exec(e.request.headers.get('range'));
        const s = +m[1], end = m[2] ? +m[2] : buf.byteLength - 1;
        return new Response(buf.slice(s, end + 1), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes ' + s + '-' + end + '/' + buf.byteLength, 'Content-Length': String(end - s + 1), 'Accept-Ranges': 'bytes' } });
      }
      return fetch(e.request);
    }));
    return;
  }
  // 数据：网络优先，断网用缓存
  if (u.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open('dr-data').then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // 页面外壳：网络优先（保证拿到新版），断网再用缓存
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open('dr-shell-' + VERSION).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
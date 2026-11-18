// Okeyhane Service Worker: macht die Seite installierbar und lädt Grafik/Musik schneller.
// Spielzustand läuft immer live über den Server (WebSocket) – hier wird nichts davon gespeichert.
const CACHE = 'okeyhane-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/ws') || req.headers.has('range')) return;
  // Große, unveränderliche Dateien: erst aus dem Cache
  if (/\.(glb|mp3|jpg|png|webp|woff2)$/.test(url.pathname) || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // Seite selbst: immer frisch vom Server, offline Notfall aus dem Cache
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.mode === 'navigate') caches.open(CACHE).then((c) => c.put('/', res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r ?? caches.match('/'))),
  );
});

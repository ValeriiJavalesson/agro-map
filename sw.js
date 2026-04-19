const CACHE_NAME = 'agro-map-v2';
const ASSETS = [
  '/agro-map/',
  '/agro-map/index.html',
  '/agro-map/styles/style.css',
  '/agro-map/js/script.js',
  '/agro-map/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});

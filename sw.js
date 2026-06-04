const CACHE_NAME = 'agro-map-v2.61';
const ASSETS = [
  '/agro-map/',
  '/agro-map/index.html',
  '/agro-map/styles/style.css',
  '/agro-map/styles/mobile.css',
  '/agro-map/styles/fonts.css',
  '/agro-map/styles/compass-mobile.css',
  '/agro-map/js/script.js',
  '/agro-map/js/mobile-script.js',
  '/agro-map/manifest.json'
];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {          
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) 
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});


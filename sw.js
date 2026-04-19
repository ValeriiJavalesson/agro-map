self.addEventListener('install', (e) => {
  console.log('Service Worker installed');
});

self.addEventListener('fetch', (e) => {
  // Просто пропускаємо запити через мережу
  e.respondWith(fetch(e.request));
});

// Service worker: guarda a página e os arquivos estáticos para abrir rápido e com sinal fraco.
// Dados e IA sempre vão para a rede.
const CACHE = 'dieta-treino-v2';
const BASE = ['/', '/index.html', '/plataforma.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.hostname.endsWith('supabase.co')) return;
  // Rede primeiro, cópia guardada como reserva.
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('fonts.g'))) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// Aviso de descanso vindo do servidor, mesmo com o app em segundo plano.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titulo: 'Descanso acabou' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    // Se o app está aberto na tela, ele mesmo já toca o alerta.
    if (cs.some((c) => c.visibilityState === 'visible')) return;
    return self.registration.showNotification(d.titulo || 'Descanso acabou', {
      body: d.corpo || 'Hora da próxima série.',
      tag: d.tag || 'descanso',
      renotify: true,
      requireInteraction: false,
      vibrate: [900, 150, 900, 150, 900],
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      timestamp: Date.now()
    });
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs[0];
    return c ? c.focus() : self.clients.openWindow('/#academia');
  }));
});

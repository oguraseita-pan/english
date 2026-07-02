/* Sprout service worker: offline no-op + Web Push受信 */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', () => {});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Sprout 🌱';
  const opts = {
    body: d.body || '今日の英語学習の時間です。連続記録を伸ばしましょう！',
    data: { url: d.url || '/' }
  };
  if (d.icon) opts.icon = d.icon;
  if (d.badge) opts.badge = d.badge;
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      for (const w of ws) { if ('focus' in w) return w.focus(); }
      return clients.openWindow(url);
    })
  );
});

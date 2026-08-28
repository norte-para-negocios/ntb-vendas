// Service worker do cardápio do cliente (Fase 5, Task 19, plano "Fora do
// Cardápio", 2026-08-27) — só cobre push notification real (funciona com
// a aba fechada/tela bloqueada). NÃO faz cache de assets/offline-first de
// propósito: isso é um projeto à parte (mudaria o comportamento de update
// do app inteiro), fora do escopo desta task.

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Cardápio Digital', body: event.data.text() };
  }
  const title = payload.title || 'Cardápio Digital';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // `url` decide pra onde o clique na notificação leva (ver
    // notificationclick abaixo) — sempre o cardápio da própria loja, nunca
    // um destino fixo (cada loja tem sua própria assinatura).
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

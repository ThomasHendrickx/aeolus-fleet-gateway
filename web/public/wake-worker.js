/*
 * The gateway's service worker (wake a person, W4): it shows a wake, which
 * says only that something waits in the fleet, by its name, and opens the
 * gateway's Bridge when the person presses it. A wake for what waits at argo
 * shows apart, under its own tag, saying it is not for the person alone
 * (argo's inbox, AI4, AI5). It holds nothing else.
 */
/* global self -- the service worker's own global scope. */
self.addEventListener('push', (event) => {
  const wake = event.data === null ? {} : event.data.json();
  const fleetName = typeof wake.fleetName === 'string' ? wake.fleetName : 'Your fleet';
  const bridgeUrl = typeof wake.bridgeUrl === 'string' ? wake.bridgeUrl : '/bridge';
  const notification =
    wake.waitsAt === 'argo'
      ? { title: `${fleetName}: something waits at argo`, body: 'Not for you alone: for everyone allowed as argo.', tag: 'aeolus-argo-wake' }
      : { title: fleetName, body: 'Something waits for you.', tag: 'aeolus-wake' };
  event.waitUntil(self.registration.showNotification(notification.title, { body: notification.body, data: { bridgeUrl }, tag: notification.tag }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.bridgeUrl));
});

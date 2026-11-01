/*
 * The gateway's service worker (wake a person, W4): it shows a wake, which
 * says only that something waits in the fleet, by its name, and opens the
 * gateway's Bridge when the person presses it. A wake for what waits at argo
 * shows apart, under its own tag and icon, saying it is not for the person alone
 * (argo's inbox, AI4, AI5). It holds nothing else.
 */
/* global self -- the service worker's own global scope. */
self.addEventListener('push', (event) => {
  const wake = event.data === null ? {} : event.data.json();
  const fleetName = typeof wake.fleetName === 'string' ? wake.fleetName : 'Your fleet';
  const bridgeUrl = typeof wake.bridgeUrl === 'string' ? wake.bridgeUrl : '/bridge';
  const notification =
    wake.waitsAt === 'argo'
      ? { title: `${fleetName}: something waits at argo`, options: { body: 'Not for you alone: for everyone allowed as argo.', data: { bridgeUrl }, tag: 'aeolus-argo-wake', icon: '/argo-wake-icon.svg' } }
      : { title: fleetName, options: { body: 'Something waits for you.', data: { bridgeUrl }, tag: 'aeolus-wake' } };
  event.waitUntil(self.registration.showNotification(notification.title, notification.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.bridgeUrl));
});

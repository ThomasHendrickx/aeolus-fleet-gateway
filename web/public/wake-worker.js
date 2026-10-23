/*
 * The gateway's service worker (wake a person, W4): it shows a wake, which
 * says only that something waits in the fleet, by its name, and opens the
 * gateway's overview when the person presses it. It holds nothing else.
 */
/* global self -- the service worker's own global scope. */
self.addEventListener('push', (event) => {
  const wake = event.data === null ? {} : event.data.json();
  const fleetName = typeof wake.fleetName === 'string' ? wake.fleetName : 'Your fleet';
  const overviewUrl = typeof wake.overviewUrl === 'string' ? wake.overviewUrl : '/overview';
  event.waitUntil(self.registration.showNotification(fleetName, { body: 'Something waits for you.', data: { overviewUrl }, tag: 'aeolus-wake' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.overviewUrl));
});

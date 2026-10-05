// Registers the service worker (production only, so it never serves stale files while developing).
export default defineNuxtPlugin(() => {
  if (!import.meta.dev && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
});

// iOS Safari ignores user-scalable=no; block the pinch gesture explicitly so the page behaves like a native app.
if (typeof document !== 'undefined') {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
}

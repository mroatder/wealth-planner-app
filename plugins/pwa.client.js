// Registers the service worker (production only, so it never serves stale files while developing).
export default defineNuxtPlugin(() => {
  if (!import.meta.dev && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
});

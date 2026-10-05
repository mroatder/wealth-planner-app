// Client-side data loader that never blocks navigation.
//
// `await useAsyncData(...)` makes Nuxt hold the old page on screen until every query has come back, and several of
// them in a row wait one after another. This version starts all queries at once and lets the page render
// immediately; `loaded` flips to true when this query has finished (successfully or not), so empty-state
// messages ("no wallets yet") can wait for it instead of flashing while data is still on its way.
export function useLoad(key, handler, { default: fallback, watch: sources } = {}) {
  const result = useAsyncData(key, handler, { server: false, lazy: true, default: fallback, watch: sources });
  const loaded = computed(() => result.status.value === 'success' || result.status.value === 'error');
  return { ...result, loaded };
}

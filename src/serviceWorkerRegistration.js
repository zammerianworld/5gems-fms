// Unregister any existing service workers and clear all caches to prevent
// stale-content issues. If an old SW/cache is found, force ONE reload so the
// very next load is guaranteed to be fresh — avoids "had to refresh twice".
export function registerSW() {
  if (!('serviceWorker' in navigator)) return

  const RELOAD_FLAG = 'ds_sw_cleanup_reloaded'

  Promise.all([
    navigator.serviceWorker.getRegistrations(),
    'caches' in window ? caches.keys() : Promise.resolve([]),
  ]).then(([registrations, cacheNames]) => {
    const hadSW = registrations.length > 0
    const hadCache = cacheNames.length > 0

    for (const registration of registrations) {
      registration.unregister()
      console.log('SW unregistered')
    }

    const cacheClearPromises = cacheNames.map(name => caches.delete(name))

    Promise.all(cacheClearPromises).then(() => {
      if (hadCache) console.log('Old caches cleared')

      // If we found and removed an old SW/cache, this page load may still be
      // controlled by it. Force exactly one reload to guarantee fresh content,
      // but only once (sessionStorage flag prevents reload loops).
      if ((hadSW || hadCache) && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
      }
    })
  }).catch((error) => {
    console.warn('SW cleanup error:', error.message)
  })
}

export function unregisterSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.unregister())
      .catch((error) => console.error(error.message))
  }
}

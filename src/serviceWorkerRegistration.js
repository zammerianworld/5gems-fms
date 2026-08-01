// Unregister any existing service workers and clear all caches to prevent
// stale-content issues. Does NOT force a reload — an immediate reload here
// can land in the middle of a fresh sign-in's session-settling window and
// contribute to an auto-logout loop. Worst case without it: a user may need
// one manual refresh to see the very latest deploy, which is an acceptable
// trade against interrupting login.
export function registerSW() {
  if (!('serviceWorker' in navigator)) return

  Promise.all([
    navigator.serviceWorker.getRegistrations(),
    'caches' in window ? caches.keys() : Promise.resolve([]),
  ]).then(([registrations, cacheNames]) => {
    for (const registration of registrations) {
      registration.unregister()
      console.log('SW unregistered')
    }

    const cacheClearPromises = cacheNames.map(name => caches.delete(name))

    Promise.all(cacheClearPromises).then(() => {
      if (cacheNames.length > 0) console.log('Old caches cleared')
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

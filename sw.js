/* SmartRek service worker — network-first HTML + whisper-worker so Android gets latest Pages build. */
/* Keep CACHE_ID in sync with web/src/lib/asset-version.ts SMARTREK_ASSET_VERSION. */
const CACHE_ID = "smartrek-20261110-notip1";
const STATIC_CACHE = `static-${CACHE_ID}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Drop every prior SmartRek / Next shell cache so PR#8 tip-on-listen JS cannot stick.
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "SMARTREK_SW_ACTIVATED", cacheId: CACHE_ID });
      }
    })(),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldNetworkFirst(request, url) {
  if (request.mode === "navigate") return true;
  if (request.destination === "document") return true;
  const path = url.pathname;
  if (path.endsWith("/sw.js")) return true;
  if (path.endsWith("/whisper-worker.js")) return true;
  if (path.endsWith(".html")) return true;
  if (path.endsWith("/") || path.endsWith("/index.html")) return true;
  // Versioned app shell chunks still hashed; HTML + worker must never stick on tip-on-listen.
  if (path.includes("/_next/static/chunks/") && request.destination === "script") {
    // Network-first for JS that may embed listen/tip logic when hashed names change slowly on Pages edge.
    return false;
  }
  return false;
}

function shouldCacheFirst(url) {
  return url.pathname.includes("/_next/static/");
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => undefined);
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (shouldNetworkFirst(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (shouldCacheFirst(url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
});

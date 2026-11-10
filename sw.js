/* SmartRek service worker — network-first HTML + whisper-worker so Android gets latest Pages build. */
/* Keep CACHE_ID in sync with web/src/lib/asset-version.ts SMARTREK_ASSET_VERSION. */
const CACHE_ID = "smartrek-20261110-wbase1";
const STATIC_CACHE = `static-${CACHE_ID}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("static-smartrek-") || key.startsWith("smartrek-") || key.startsWith("static-"))
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
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
});

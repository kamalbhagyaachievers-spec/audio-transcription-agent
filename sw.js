
const CACHE_NAME = "ba-transcription-v1";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./worker.js",
    "./manifest.json"
];

// Cache application files

self.addEventListener("install", (event) => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(APP_FILES);
            })
            .then(() => self.skipWaiting())
    );

});

// Remove outdated application caches

self.addEventListener("activate", (event) => {

    event.waitUntil(
        caches.keys()
            .then((keys) => {

                return Promise.all(
                    keys
                        .filter((key) =>
                            key.startsWith("ba-transcription-") &&
                            key !== CACHE_NAME
                        )
                        .map((key) => caches.delete(key))
                );

            })
            .then(() => self.clients.claim())
    );

});

// Serve cached resources when offline

self.addEventListener("fetch", (event) => {

    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    const allowed =
        url.origin === self.location.origin ||
        url.hostname === "cdn.jsdelivr.net";

    if (!allowed) return;

    event.respondWith(

        (async () => {

            const cache = await caches.open(CACHE_NAME);

            try {

                const response = await fetch(request);

                if (
                    response.ok &&
                    response.status === 200
                ) {

                    await cache.put(
                        request,
                        response.clone()
                    ).catch(() => {});

                }

                return response;

            } catch (error) {

                const cached = await cache.match(request);

                if (cached) {
                    return cached;
                }

                if (request.mode === "navigate") {

                    const fallback = await cache.match(
                        "./index.html"
                    );

                    if (fallback) return fallback;

                }

                throw error;

            }

        })()

    );

});

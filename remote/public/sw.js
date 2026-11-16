// Makes the app installable and quick to open. It is deliberately simple: the shell is cached so
// the page starts offline, and everything else goes to the network untouched -- no request to the
// relay may ever be answered from a cache, because a stale reply about a repository is worse than
// an error.

const SHELL = "gitpilot-remote-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(["./", "./manifest.webmanifest"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const ours = url.origin === self.location.origin && url.pathname.startsWith("/remote/");
  if (!ours) return; // The relay, and anything else, always goes to the network.

  event.respondWith(
    // Network first, so a published update is picked up as soon as the phone is online.
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match("./"))),
  );
});

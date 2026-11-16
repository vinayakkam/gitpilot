// Installing the page as an app, and keeping it up to date.
//
// Chrome fires `beforeinstallprompt` when the page qualifies (served over HTTPS, a manifest with
// icons, a service worker with a fetch handler). Holding on to that event lets the app offer
// installation in its own words, at a sensible moment, instead of leaving the user to find
// "Add to home screen" in a menu.

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let pending: InstallEvent | null = null;
const listeners = new Set<(available: boolean) => void>();
const DISMISSED = "gitpilot.remote.installDismissed";

function announce() {
  for (const listener of listeners) listener(pending !== null);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // Chrome's own banner would cover the app; we ask in our own layout.
  pending = event as InstallEvent;
  announce();
});

window.addEventListener("appinstalled", () => {
  pending = null;
  announce();
});

/** Already running as an installed app, so there is nothing to offer. */
export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || "standalone" in navigator;
}

export function installDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISSED, "1");
  } catch {
    // Not worth telling anyone: the offer simply comes back next time.
  }
  pending = null;
  announce();
}

/** Shows the browser's install dialog. Returns true if the app was installed. */
export async function install(): Promise<boolean> {
  if (!pending) return false;
  const event = pending;
  pending = null;
  announce();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  listeners.add(listener);
  listener(pending !== null);
  return () => listeners.delete(listener);
}

/** Registers the service worker. Without one the app can't be installed and won't open offline. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {
      // Installation and offline start are nice to have; the app works without them.
    });
  });
}

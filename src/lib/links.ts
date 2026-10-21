import { openUrl } from "@tauri-apps/plugin-opener";

export const LINK_FAILED_EVENT = "gitpilot:link-failed";

/**
 * Opens a web page in the user's browser. Only https:// links are allowed (see
 * src-tauri/capabilities). If the browser can't be opened, the app shows a message with
 * the link instead of failing silently.
 */
export async function openLink(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    console.error("Couldn't open link", url, e);
    window.dispatchEvent(new CustomEvent(LINK_FAILED_EVENT, { detail: url }));
  }
}

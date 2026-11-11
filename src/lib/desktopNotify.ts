import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Asks the OS for permission to show notifications; true when allowed. */
export async function allowDesktopNotifications(): Promise<boolean> {
  try {
    return (await isPermissionGranted()) || (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Shows a desktop notification, but only while no GitPilot window is in front (the toast covers that). */
export async function notifyDesktop(title: string, body?: string): Promise<void> {
  if (document.hasFocus()) return;
  try {
    if (await isPermissionGranted()) sendNotification(body ? { title, body } : { title });
  } catch {
    // The toast is still shown; a desktop notification is a nice-to-have.
  }
}

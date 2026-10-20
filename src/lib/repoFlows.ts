import { open } from "@tauri-apps/plugin-dialog";

/** Native folder picker. Returns null when cancelled. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const r = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof r === "string" ? r : null;
}

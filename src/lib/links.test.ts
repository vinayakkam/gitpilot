import { openUrl } from "@tauri-apps/plugin-opener";
import { LINK_FAILED_EVENT, openLink } from "./links";
import capabilities from "../../src-tauri/capabilities/default.json";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("openLink", () => {
  it("opens the link in the browser", async () => {
    vi.mocked(openUrl).mockResolvedValue();
    await openLink("https://github.com/vinayakkam/gitpilot");
    expect(openUrl).toHaveBeenCalledWith("https://github.com/vinayakkam/gitpilot");
  });

  it("reports a failure instead of doing nothing", async () => {
    vi.mocked(openUrl).mockRejectedValue(new Error("Not allowed to open url"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener(LINK_FAILED_EVENT, on);
    await openLink("https://olittechnologies.co.in/projects/git-pilot/");
    window.removeEventListener(LINK_FAILED_EVENT, on);
    expect(seen).toEqual(["https://olittechnologies.co.in/projects/git-pilot/"]);
  });

  it("the app is allowed to open https links (and only https)", () => {
    const perm = capabilities.permissions.find((p) => typeof p === "object" && p.identifier === "opener:allow-open-url");
    expect(perm).toEqual({ identifier: "opener:allow-open-url", allow: [{ url: "https://*" }] });
  });
});

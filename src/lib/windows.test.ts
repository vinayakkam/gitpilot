import { isMainWindow, windowLabel, windowRepoId } from "./windows";

describe("windows", () => {
  it("reads the repository from a window label", () => {
    expect(windowRepoId("repo-12")).toBe(12);
    expect(windowRepoId("main")).toBeNull();
    expect(windowRepoId("repo-x")).toBeNull();
  });

  it("outside Tauri, behaves as the main window", () => {
    expect(windowLabel()).toBe("main");
    expect(isMainWindow()).toBe(true);
  });
});

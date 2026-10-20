import { plural, relativeTime, repoNameFromUrl, splitPath } from "./format";

describe("format helpers", () => {
  it("splits paths into name and directory", () => {
    expect(splitPath("src/auth/session.ts")).toEqual({ name: "session.ts", dir: "src/auth" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", dir: "" });
  });

  it("derives a folder name from clone URLs", () => {
    expect(repoNameFromUrl("https://github.com/acme/web-app.git")).toBe("web-app");
    expect(repoNameFromUrl("git@gitlab.com:acme/tools.git")).toBe("tools");
    expect(repoNameFromUrl("ssh://git@host:2222/team/repo/")).toBe("repo");
  });

  it("formats relative time", () => {
    const now = 1_000_000;
    expect(relativeTime(now - 10, now)).toBe("just now");
    expect(relativeTime(now - 3 * 3600, now)).toMatch(/3 hours ago/);
  });

  it("pluralizes", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
  });
});

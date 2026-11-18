import { fromB64Url, importKey, open, OpenFailed, seal, toB64Url } from "./crypto";

/** The same key the desktop's cross-language test uses: bytes 0x00..0x1f. */
const KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const NOW = 1_763_300_000;

describe("the sealed envelope", () => {
  it("opens one that the desktop actually produced", async () => {
    // Sealed by `remote::crypto::seal` in Rust (aes-gcm crate). If the two sides ever drift
    // apart, this fails here rather than as a phone that mysteriously never connects.
    const fromRust = {
      v: 1,
      id: "phone~pc",
      seq: 3,
      ts: NOW,
      nonce: "umzcYETvzPYSFFYK",
      ct: "C_YPMbMisfJlBo0xO-oxUpmauHAtnBEmji_RiuwfCWPGjK8jQsPZXuDcf0e35UMSHLuof5fp38ir9ioUEHicrBx7y80Qdq6spcZktuLkFbmo8B7-3eeFJTzB",
    };

    const plain = await open(await importKey(KEY_B64), fromRust, "phone~pc", NOW);

    expect(JSON.parse(plain)).toEqual({
      ok: true,
      message: "2 repositories",
      kind: null,
      detail: null,
      data: [],
    });
  });

  it("round-trips its own messages", async () => {
    const key = await importKey(KEY_B64);
    const env = await seal(key, "phone", 1, JSON.stringify({ cmd: "list" }));

    expect(await open(key, { ...env, id: "phone" }, "phone")).toBe('{"cmd":"list"}');
  });

  it("refuses an answer from anything but the paired computer", async () => {
    const key = await importKey(KEY_B64);
    const env = await seal(key, "someone-else", 1, "x");

    await expect(open(key, env, "phone~pc")).rejects.toBeInstanceOf(OpenFailed);
  });

  it("refuses the same answer twice, however it is numbered", async () => {
    const key = await importKey(KEY_B64);
    const env = await seal(key, "phone~pc", 5, "x");

    expect(await open(key, env, "phone~pc")).toBe("x");
    await expect(open(key, env, "phone~pc")).rejects.toThrow(/already handled/);
    await expect(open(key, { ...env, seq: 99 }, "phone~pc")).rejects.toThrow(/already handled/);
  });

  it("still listens to a computer that lost its counter", async () => {
    // Why this isn't a counter any more: GitPilot reinstalled, or settings restored from a backup,
    // used to mean every answer it sent looked like a replay and the pairing was dead for good.
    const key = await importKey(KEY_B64);

    expect(await open(key, await seal(key, "phone~pc", 900, "a"), "phone~pc")).toBe("a");
    expect(await open(key, await seal(key, "phone~pc", 1, "b"), "phone~pc")).toBe("b");
  });

  it("refuses an answer from far outside the clock window", async () => {
    const key = await importKey(KEY_B64);
    const env = await seal(key, "phone~pc", 1, "x");

    await expect(open(key, env, "phone~pc", NOW + 10_000)).rejects.toThrow(/clock/i);
  });

  it("refuses a tampered answer", async () => {
    const key = await importKey(KEY_B64);
    const env = await seal(key, "phone~pc", 1, "x");
    const broken = { ...env, ct: toB64Url(fromB64Url(env.ct).map((b, i) => (i === 0 ? b ^ 1 : b))) };

    await expect(open(key, broken, "phone~pc")).rejects.toThrow(/couldn't be unlocked/);
  });

  it("refuses a key that isn't 256 bits", async () => {
    await expect(importKey("c2hvcnQ")).rejects.toThrow(/isn't complete/);
  });

  it("uses the URL-safe alphabet both ways", () => {
    const bytes = new Uint8Array([251, 255, 190, 0]);

    expect(toB64Url(bytes)).toBe("-_--AA");
    expect(Array.from(fromB64Url("-_--AA"))).toEqual([251, 255, 190, 0]);
  });
});

import { derive } from "./derive";

const KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("deriving a pairing's channel", () => {
  it("agrees with the desktop, value for value", async () => {
    // These are the values the desktop's own test pins (remote/crypto.rs). If the two ever drift,
    // a paired phone would quietly rebuild a different channel and never be heard from again.
    expect(await derive(KEY_B64)).toEqual({
      channel: "hjoZLkFtPEWsTJb6iHtLhg",
      pcSecret: "h1EYZeUoYGC_hJ1Gp0lSQ6zI",
      secret: "FCWHXj2LrPJ7_q0i1qX5ppW_",
      device: "d3Dhez5C6LKhp",
    });
  });

  it("gives each key its own channel", async () => {
    const other = await derive("H4sIAAAAAAAAA0tMSk5JTUvPyMzKzsnNyy8oLAIA");

    expect(other.channel).not.toBe("hjoZLkFtPEWsTJb6iHtLhg");
    expect(other.secret).not.toBe(other.pcSecret);
  });

  it("produces values the relay will accept", async () => {
    const { channel, secret, pcSecret } = await derive(KEY_B64);

    for (const value of [channel, secret, pcSecret]) {
      expect(value.length).toBeGreaterThanOrEqual(16);
      expect(value.length).toBeLessThanOrEqual(64);
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

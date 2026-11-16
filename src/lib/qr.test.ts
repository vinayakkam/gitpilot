import jsQR from "jsqr";
import { capacity, encodeQr, qrPath } from "./qr";

/**
 * Renders a QR grid the way a camera sees it -- a quiet zone around it, several pixels per
 * module -- and reads it back with a real decoder. That is the only check worth making here:
 * the encoder is only correct if something that isn't the encoder can read its output.
 */
function scan(text: string): string | null {
  const grid = encodeQr(text);
  const scale = 4;
  const quiet = 4;
  const size = (grid.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);

  grid.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + quiet) * scale + y) * size + ((c + quiet) * scale + x);
          pixels[px * 4] = 0;
          pixels[px * 4 + 1] = 0;
          pixels[px * 4 + 2] = 0;
        }
      }
    });
  });

  return jsQR(pixels, size, size)?.data ?? null;
}

describe("qr", () => {
  it("produces a code a decoder can actually read", () => {
    expect(scan("https://olittechnologies.co.in/remote/")).toBe("https://olittechnologies.co.in/remote/");
  });

  it("round-trips a real pairing URL, key and all", () => {
    // The length GitPilot actually produces: channel id, two 32-character secrets, a device id.
    const url =
      "https://olittechnologies.co.in/remote/#i=AbCdEfGhIjKlMnOp&s=0123456789abcdef0123456789abcdef&k=Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE&d=dAbCdEfGhIjKlMnOp";

    expect(scan(url)).toBe(url);
  });

  it("reads back short and long payloads alike", () => {
    expect(scan("a")).toBe("a");
    const long = `https://example.com/${"x".repeat(150)}`;
    expect(scan(long)).toBe(long);
  });

  it("handles non-ASCII, since a phone name could be anything", () => {
    const text = "https://example.com/#n=Pixel-Ünïcode-日本";
    expect(scan(text)).toBe(text);
  });

  it("refuses to encode more than it can hold instead of truncating", () => {
    // Silently dropping the end would produce a code that scans to the wrong URL.
    expect(() => encodeQr("x".repeat(capacity(10) + 1))).toThrow(/too long/i);
  });

  it("grows the symbol only as much as it needs to", () => {
    expect(encodeQr("short").length).toBe(21); // version 1
    expect(encodeQr("x".repeat(capacity(1))).length).toBe(21);
    expect(encodeQr("x".repeat(capacity(1) + 1)).length).toBe(25); // version 2
  });

  it("draws one path square per dark module", () => {
    const grid = encodeQr("test");
    const dark = grid.flat().filter(Boolean).length;

    expect(qrPath(grid).match(/M/g)?.length).toBe(dark);
  });
});

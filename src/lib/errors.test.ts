import { isAppError, toAppError } from "./errors";

describe("toAppError", () => {
  it("passes backend errors through", () => {
    const e = { kind: "pushRejected", message: "Rejected", detail: "! [rejected]" };
    expect(isAppError(e)).toBe(true);
    expect(toAppError(e)).toBe(e);
  });
  it("wraps unknown values", () => {
    expect(toAppError(new Error("boom"))).toEqual({ kind: "internal", message: "boom", detail: null });
    expect(toAppError("text").message).toBe("text");
    expect(isAppError({ kind: "nope", message: "x" })).toBe(false);
  });
});

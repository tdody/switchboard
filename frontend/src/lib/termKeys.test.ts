import { describe, expect, it } from "vitest";
import { comboBytes, escAction } from "./termKeys";

describe("escAction", () => {
  it("returns 'send' for the first Esc (no prior press)", () => {
    expect(escAction(1_000_000, 0)).toBe("send");
  });

  it("returns 'close' for a second Esc within 400ms", () => {
    expect(escAction(1_000_300, 1_000_000)).toBe("close");
  });

  it("returns 'close' for a second Esc at exactly 400ms (inclusive boundary)", () => {
    expect(escAction(1_000_400, 1_000_000)).toBe("close");
  });

  it("returns 'send' for a second Esc after 400ms", () => {
    expect(escAction(1_000_500, 1_000_000)).toBe("send");
  });
});

describe("comboBytes", () => {
  it("maps Cmd+Backspace to Ctrl-U", () => {
    expect(comboBytes({ metaKey: true, key: "Backspace" })).toBe("\x15");
  });

  it("maps Cmd+Delete to Ctrl-K", () => {
    expect(comboBytes({ metaKey: true, key: "Delete" })).toBe("\x0b");
  });

  it("maps Cmd+ArrowLeft / ArrowRight to Ctrl-A / Ctrl-E", () => {
    expect(comboBytes({ metaKey: true, key: "ArrowLeft" })).toBe("\x01");
    expect(comboBytes({ metaKey: true, key: "ArrowRight" })).toBe("\x05");
  });

  it("returns null without the meta key", () => {
    expect(comboBytes({ metaKey: false, key: "Backspace" })).toBeNull();
  });

  it("returns null for unrelated combos", () => {
    expect(comboBytes({ metaKey: true, key: "c" })).toBeNull();
  });
});

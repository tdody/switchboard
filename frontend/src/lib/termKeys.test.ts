import { describe, expect, it } from "vitest";
import { comboBytes, escAction, newlineBytes } from "./termKeys";

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

describe("newlineBytes", () => {
  // Claude Code (Ink) accepts ESC + CR (the Option/Alt+Enter convention) as
  // an in-prompt newline; bare CR submits. xterm.js emits CR for both Enter
  // and Shift+Enter by default, so we have to translate Shift+Enter
  // ourselves before xterm's default fires.
  it("maps Shift+Enter to ESC + CR", () => {
    expect(
      newlineBytes({
        key: "Enter",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe("\x1b\r");
  });

  it("returns null for plain Enter (xterm sends CR as usual)", () => {
    expect(
      newlineBytes({
        key: "Enter",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("returns null for Shift+Enter combined with another modifier", () => {
    // Ctrl/Cmd/Alt+Shift+Enter is reserved for whatever the app or browser
    // wants; we only own the bare Shift+Enter case.
    expect(
      newlineBytes({
        key: "Enter",
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      newlineBytes({
        key: "Enter",
        shiftKey: true,
        metaKey: false,
        ctrlKey: true,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      newlineBytes({
        key: "Enter",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: true,
      }),
    ).toBeNull();
  });

  it("returns null for non-Enter keys", () => {
    expect(
      newlineBytes({
        key: "Tab",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });
});

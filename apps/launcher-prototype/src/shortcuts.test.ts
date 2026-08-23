import { describe, expect, it } from "vitest";
import { shortcutFromKeyboardEvent, validateShortcut } from "./shortcuts";

const keyboardEvent = (options: KeyboardEventInit) => new KeyboardEvent("keydown", options);

describe("keyboard shortcuts", () => {
  it("formats modifier keys in macOS order", () => {
    expect(
      shortcutFromKeyboardEvent(
        keyboardEvent({ code: "KeyG", key: "G", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("⌃⇧G");
  });

  it("rejects shortcuts used by macOS and common app commands", () => {
    expect(validateShortcut("⌘C")).toContain("reserved for Copy");
    expect(validateShortcut("⇧⌘4")).toContain("reserved for Screenshot Selection");
    expect(validateShortcut("⌥⌘Esc")).toContain("reserved for Force Quit");
    expect(validateShortcut("⌘T")).toBeNull();
  });

  it("requires a non-typing modifier and rejects Tool conflicts", () => {
    expect(validateShortcut("⇧G")).toContain("Add Command, Option, or Control");
    expect(validateShortcut("⌃⇧G", ["⌃⇧G"])).toContain("already used by another Tool");
    expect(validateShortcut("⌃⇧G")).toBeNull();
  });
});

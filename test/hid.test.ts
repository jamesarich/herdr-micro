import { describe, expect, test } from "bun:test";

import { parseChord, type Chord } from "../src/hid.ts";

describe("parseChord", () => {
  test("maps a bare letter to its HID keycode name", () => {
    expect(parseChord("w")).toEqual({ modifiers: [], key: "W" });
  });

  test("maps herdr's prefix chord to control plus the letter", () => {
    expect(parseChord("ctrl+b")).toEqual({ modifiers: ["LEFT_CONTROL"], key: "B" });
  });

  test("accepts several modifiers in any order", () => {
    expect(parseChord("shift+ctrl+p")).toEqual({
      modifiers: ["LEFT_CONTROL", "LEFT_SHIFT"],
      key: "P",
    });
  });

  test("spells the navigation keys Herdr's workspace picker uses", () => {
    expect(parseChord("up")).toEqual({ modifiers: [], key: "UP_ARROW" });
    expect(parseChord("down")).toEqual({ modifiers: [], key: "DOWN_ARROW" });
    expect(parseChord("enter")).toEqual({ modifiers: [], key: "ENTER" });
    expect(parseChord("esc")).toEqual({ modifiers: [], key: "ESCAPE" });
  });

  test("rejects an unknown key rather than silently sending nothing", () => {
    expect(() => parseChord("nope")).toThrow("Unknown HID key");
    expect(() => parseChord("ctrl+nope")).toThrow("Unknown HID key");
  });

  test("rejects a chord with no key", () => {
    expect(() => parseChord("ctrl+")).toThrow();
  });
});

describe("chord ordering", () => {
  test("a chord presses modifiers before the key and releases in reverse", async () => {
    const sent: string[] = [];
    const { pressChord } = await import("../src/hid.ts");
    const chord: Chord = { modifiers: ["LEFT_CONTROL"], key: "B" };
    await pressChord(chord, (key, down) => {
      sent.push(`${down ? "+" : "-"}${key}`);
      return Promise.resolve();
    });
    // Releasing the key before the modifier is what makes it a chord rather
    // than two separate keystrokes.
    expect(sent).toEqual(["+LEFT_CONTROL", "+B", "-B", "-LEFT_CONTROL"]);
  });
});

describe("digits", () => {
  // adafruit_hid spells digit keycodes as words: Keycode.ONE, not Keycode.1,
  // which is not even a valid identifier.
  test("maps digits to their keycode words", () => {
    expect(parseChord("1")).toEqual({ modifiers: [], key: "ONE" });
    expect(parseChord("9")).toEqual({ modifiers: [], key: "NINE" });
    expect(parseChord("0")).toEqual({ modifiers: [], key: "ZERO" });
  });

  test("handles the indexed-shortcut chords Herdr binds", () => {
    expect(parseChord("ctrl+super+3")).toEqual({
      modifiers: ["LEFT_CONTROL", "LEFT_GUI"],
      key: "THREE",
    });
  });
});

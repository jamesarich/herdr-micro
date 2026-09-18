/**
 * Chords the Deck types on the host as a USB HID keyboard.
 *
 * This is deliberately separate from Send Keys. Send Keys goes through Herdr's
 * `agent.send_keys` and lands in an agent's terminal, so Herdr's own prefix
 * never sees it. A HID chord goes to whatever window has focus, which is how
 * the Deck can drive the Herdr *client* — its machine and workspace navigation
 * is client-side UI state that no socket call can reach.
 */

/** Friendly spellings accepted in config, mapped to CircuitPython Keycode names. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: "ESCAPE",
  escape: "ESCAPE",
  enter: "ENTER",
  return: "ENTER",
  tab: "TAB",
  space: "SPACEBAR",
  backspace: "BACKSPACE",
  delete: "DELETE",
  up: "UP_ARROW",
  down: "DOWN_ARROW",
  left: "LEFT_ARROW",
  right: "RIGHT_ARROW",
  home: "HOME",
  end: "END",
  pageup: "PAGE_UP",
  pagedown: "PAGE_DOWN",
  insert: "INSERT",
};

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  ctrl: "LEFT_CONTROL",
  control: "LEFT_CONTROL",
  shift: "LEFT_SHIFT",
  alt: "LEFT_ALT",
  opt: "LEFT_ALT",
  option: "LEFT_ALT",
  cmd: "LEFT_GUI",
  gui: "LEFT_GUI",
  super: "LEFT_GUI",
  win: "LEFT_GUI",
  meta: "LEFT_GUI",
};

// Held in a stable order so a chord's wire form does not depend on how the
// user happened to spell it.
const MODIFIER_ORDER = ["LEFT_CONTROL", "LEFT_SHIFT", "LEFT_ALT", "LEFT_GUI"] as const;

export interface Chord {
  readonly modifiers: ReadonlyArray<string>;
  readonly key: string;
}

const keycodeFor = (token: string): string | undefined => {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  return undefined;
};

/** Parse a chord such as `ctrl+b`, `shift+ctrl+p` or `up`. */
export function parseChord(chord: string): Chord {
  const parts = chord.split("+").map((part) => part.trim());
  const keyToken = parts.pop();
  if (!keyToken) throw new Error(`Chord ${JSON.stringify(chord)} has no key`);

  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier) throw new Error(`Unknown HID modifier ${JSON.stringify(part)}`);
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }

  const key = keycodeFor(keyToken);
  if (!key) throw new Error(`Unknown HID key ${JSON.stringify(keyToken)}`);

  return {
    modifiers: MODIFIER_ORDER.filter((name) => modifiers.includes(name)),
    key,
  };
}

/**
 * Type one chord. Modifiers go down first and come up last, so the host sees a
 * single chord rather than a sequence of unrelated keystrokes.
 */
export async function pressChord(
  chord: Chord,
  send: (key: string, down: boolean) => Promise<void>,
): Promise<void> {
  for (const modifier of chord.modifiers) await send(modifier, true);
  await send(chord.key, true);
  await send(chord.key, false);
  for (const modifier of [...chord.modifiers].reverse()) await send(modifier, false);
}

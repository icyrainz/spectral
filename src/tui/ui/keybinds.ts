import type { KeyEvent } from "@opentui/core";

export interface KeyBinding {
  key: string;
  action: string;
}

interface SequenceState {
  first: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface KeybindRegistry {
  match: (key: KeyEvent) => string | null;
  pending: () => string | null;
  destroy: () => void;
}

export function createKeybindRegistry(bindings: KeyBinding[], timeout = 500): KeybindRegistry {
  let sequence: SequenceState | null = null;

  const singleBindings = new Map<string, string>();
  const sequenceBindings = new Map<string, string>();

  // Sequence keys: exactly 2 chars, each is a single printable keystroke.
  // Named keys like "up", "down" are NOT sequences even though length === 2.
  // Sequences: "gg", "dd", "]t", "[r" — char + char combos.
  // We detect named keys by checking: if both chars are lowercase letters AND
  // the combo is different from char+char (i.e., it's a word), it's a named key.
  // Simple heuristic: sequences always have either repeated chars or non-alpha first char.
  const NAMED_KEYS = new Set(["up", "fn"]);

  for (const b of bindings) {
    if (b.key.length === 2 && !b.key.startsWith("C-") && !NAMED_KEYS.has(b.key)) {
      sequenceBindings.set(b.key, b.action);
    } else {
      singleBindings.set(b.key, b.action);
    }
  }

  const sequenceStarters = new Set<string>();
  for (const key of sequenceBindings.keys()) {
    sequenceStarters.add(key[0]);
  }

  function keyToString(key: KeyEvent): string {
    if (key.ctrl && key.name) return `C-${key.name}`;
    // For shifted keys, prefer sequence (gives "?", ":", etc.) over name.toUpperCase()
    if (key.shift && key.sequence) return key.sequence;
    if (key.shift && key.name) return key.name.toUpperCase();
    return key.sequence || key.name || "";
  }

  function match(key: KeyEvent): string | null {
    const keyStr = keyToString(key);
    let skipSequenceCheck = false;

    if (sequence) {
      const seq = sequence.first + keyStr;
      clearTimeout(sequence.timer);
      sequence = null;

      const action = sequenceBindings.get(seq);
      if (action) return action;
      skipSequenceCheck = true; // Don't start a new sequence with the failed second key
    }

    // Check ctrl variants first
    if (key.ctrl && key.name) {
      const action = singleBindings.get(`C-${key.name}`);
      if (action) return action;
    }

    // Check if this starts a sequence (but not if ctrl is held, and not if from failed sequence)
    if (!key.ctrl && !skipSequenceCheck && sequenceStarters.has(keyStr)) {
      sequence = {
        first: keyStr,
        timer: setTimeout(() => { sequence = null; }, timeout),
      };
      return null;
    }

    // Shift variants
    if (key.shift && key.name) {
      const upper = key.name.toUpperCase();
      const action = singleBindings.get(upper);
      if (action) return action;
    }

    return singleBindings.get(keyStr) ?? null;
  }

  function pendingStr(): string | null {
    if (!sequence) return null;
    return `${sequence.first}...`;
  }

  function destroy(): void {
    if (sequence) {
      clearTimeout(sequence.timer);
      sequence = null;
    }
  }

  return { match, pending: pendingStr, destroy };
}

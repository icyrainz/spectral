import type { Hint } from "./hint-bar";

/**
 * Central keymap definitions.
 * All keybinding display labels live here — components import hints from this file.
 * To remap a key, change it here and in the bindings array in app.ts.
 */

// --- Main pager ---

export const PAGER_HINTS = {
  navigate: { key: "j/k", action: "navigate" } as Hint,
  comment: { key: "c", action: "comment" } as Hint,
  resolve: { key: "r", action: "resolve" } as Hint,
  submit: { key: "S", action: "submit" } as Hint,
  approve: { key: "A", action: "approve" } as Hint,
  help: { key: "?", action: "help" } as Hint,
};

// --- Thread popup ---

export const THREAD_NORMAL_HINTS: Hint[] = [
  { key: "NORMAL", action: "" },
  { key: "c", action: "reply" },
  { key: "r", action: "resolve" },
  { key: "q/Esc", action: "close" },
];

export const THREAD_INSERT_HINTS: Hint[] = [
  { key: "INSERT", action: "" },
  { key: "Tab", action: "send" },
  { key: "Esc", action: "normal" },
];

// --- Thread list ---

export const THREAD_LIST_HINTS: Hint[] = [
  { key: "j/k", action: "navigate" },
  { key: "Enter", action: "jump" },
  { key: "Ctrl+f", action: "filter" },
  { key: "q/Esc", action: "close" },
];

// --- Help overlay ---

export const HELP_HINTS: Hint[] = [
  { key: "j/k", action: "navigate" },
  { key: "q/?/Esc", action: "close" },
];

// --- Confirm dialog ---

export const CONFIRM_HINTS: Hint[] = [
  { key: "y/Enter", action: "yes" },
  { key: "q/Esc", action: "cancel" },
];

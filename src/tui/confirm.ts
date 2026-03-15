import {
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { createDialog } from "./ui/dialog";
import { CONFIRM_HINTS } from "./ui/keymap";

export interface ConfirmOptions {
  renderer: CliRenderer;
  message: string;
  title?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ConfirmOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

/**
 * Create a confirmation dialog overlay.
 * Shows a message with [y/n] prompt.
 * y → confirm, n/Esc → cancel
 */
export function createConfirm(opts: ConfirmOptions): ConfirmOverlay {
  const { renderer, message, title = "Confirm", onConfirm, onCancel } = opts;

  const dialog = createDialog({
    renderer,
    title,
    width: "50%",
    height: 9,
    top: "35%",
    left: "25%",
    borderColor: theme.warning,
    onDismiss: onCancel,
    hints: CONFIRM_HINTS,
  });

  const msgText = new TextRenderable(renderer, {
    content: message,
    width: "100%",
    fg: theme.text,
    wrapMode: "word",
  });

  dialog.content.add(msgText);

  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "y" || key.name === "return") {
      key.preventDefault();
      key.stopPropagation();
      onConfirm();
      return;
    }
    if (key.name === "n" || key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    // Esc is handled by dialog's built-in handler (calls onDismiss = onCancel)
  };

  renderer.keyInput.on("keypress", extraKeyHandler);

  return {
    container: dialog.container,
    cleanup() {
      dialog.cleanup();
      renderer.keyInput.off("keypress", extraKeyHandler);
    },
  };
}

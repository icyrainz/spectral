import {
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { createDialog } from "./ui/dialog";

export interface ConfirmOptions {
  renderer: CliRenderer;
  message: string;
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
  const { renderer, message, onConfirm, onCancel } = opts;

  const dialog = createDialog({
    renderer,
    title: "Confirm",
    width: "50%",
    height: 7,
    top: "35%",
    left: "25%",
    borderColor: theme.warning,
    onDismiss: onCancel,
    hints: [
      { key: "y", action: "yes" },
      { key: "n/Esc", action: "no" },
    ],
  });

  const msgText = new TextRenderable(renderer, {
    content: message,
    width: "100%",
    height: 1,
    fg: theme.text,
    wrapMode: "none",
    truncate: true,
  });

  dialog.content.add(msgText);

  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "y") {
      key.preventDefault();
      key.stopPropagation();
      onConfirm();
      return;
    }
    if (key.name === "n") {
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

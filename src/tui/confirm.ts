import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./theme";

export interface ConfirmOptions {
  renderer: CliRenderer;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ConfirmOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

/**
 * Create a confirmation dialog overlay.
 * Shows a message with [y/n] prompt.
 * y → confirm, n/Esc → cancel
 */
export function createConfirm(opts: ConfirmOptions): ConfirmOverlay {
  const { renderer, message, onConfirm, onCancel } = opts;

  // Centered dialog
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "35%",
    left: "25%",
    width: "50%",
    height: 7,
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderConfirm,
    title: " Confirm ",
    flexDirection: "column",
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
  });

  const msgText = new TextRenderable(renderer, {
    content: message,
    width: "100%",
    height: 1,
    fg: theme.text,
    wrapMode: "none",
    truncate: true,
  });

  const hint = new TextRenderable(renderer, {
    content: " [y] yes  [n/Esc] no",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(msgText);
  container.add(hint);

  // Key handler
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "y") {
      key.preventDefault();
      key.stopPropagation();
      onConfirm();
      return;
    }
    if (key.name === "n" || key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, cleanup };
}

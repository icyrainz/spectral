import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread } from "../protocol/types";

export interface CommentInputOptions {
  renderer: CliRenderer;
  line: number;
  existingThread: Thread | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export interface CommentInputOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

/**
 * Create a comment input overlay.
 * - If no existing thread: "New comment on line N"
 * - If existing thread: "Reply to thread #N"
 *
 * Ctrl+Enter submits, Esc cancels.
 */
export function createCommentInput(opts: CommentInputOptions): CommentInputOverlay {
  const { renderer, line, existingThread, onSubmit, onCancel } = opts;

  const label = existingThread
    ? `Reply to thread #${existingThread.id}`
    : `New comment on line ${line}`;

  // Overlay container - absolute positioned, centered
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "20%",
    left: "10%",
    width: "80%",
    height: 12,
    zIndex: 100,
    backgroundColor: "#1e1e2e",
    border: true,
    borderStyle: "single",
    borderColor: "#89b4fa",
    title: ` ${label} `,
    flexDirection: "column",
    padding: 1,
  });

  // Textarea for input
  const textarea = new TextareaRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    backgroundColor: "#313244",
    textColor: "#cdd6f4",
    focusedBackgroundColor: "#313244",
    focusedTextColor: "#cdd6f4",
    wrapMode: "word",
    placeholder: "Type your comment...",
    placeholderColor: "#6c7086",
  });

  // Hint line
  const hint = new TextRenderable(renderer, {
    content: " [Ctrl+Enter] submit  [Esc] cancel",
    width: "100%",
    height: 1,
    fg: "#6c7086",
    wrapMode: "none",
    truncate: true,
  });

  container.add(textarea);
  container.add(hint);

  // Focus the textarea so it receives keypress events.
  // Use setTimeout to ensure the renderable is mounted before focusing.
  setTimeout(() => {
    textarea.focus();
    renderer.requestRender();
  }, 0);

  // Key handler for Ctrl+Enter to submit and Esc to cancel
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    // Ctrl+Enter submits
    if (key.ctrl && key.name === "return") {
      key.preventDefault();
      key.stopPropagation();
      const text = textarea.plainText.trim();
      if (text.length > 0) {
        onSubmit(text);
      } else {
        onCancel();
      }
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
    textarea.destroy();
  }

  return { container, cleanup };
}

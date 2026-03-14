import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread } from "../protocol/types";
import { theme } from "./theme";

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

const MAX_CONTEXT_LENGTH = 80;

/**
 * Create a comment input overlay.
 * - If no existing thread: "New comment on line N"
 * - If existing thread: "Reply to thread #N" with last message context
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
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderComment,
    title: ` ${label} `,
    flexDirection: "column",
    padding: 1,
  });

  // Show previous messages as read-only context when replying
  if (existingThread && existingThread.messages.length > 0) {
    const contextLines = existingThread.messages.map((msg) => {
      const icon = msg.author === "human" ? "You" : "AI";
      const preview = msg.text.replace(/\n/g, " ");
      return ` ${icon}: ${preview.length > MAX_CONTEXT_LENGTH ? preview.slice(0, MAX_CONTEXT_LENGTH - 1) + "\u2026" : preview}`;
    });
    const contextText = new TextRenderable(renderer, {
      content: contextLines.join("\n"),
      width: "100%",
      height: Math.min(contextLines.length, 4),
      fg: theme.overlay,
      wrapMode: "none",
      truncate: true,
    });
    container.add(contextText);
  }

  // Pre-fill only if the last message is from human (editing own draft in same session).
  // If AI has replied (last message is from AI, or status is pending), start empty.
  let initialValue = "";
  if (existingThread && existingThread.messages.length > 0) {
    const lastMsg = existingThread.messages[existingThread.messages.length - 1];
    if (lastMsg.author === "human") {
      initialValue = lastMsg.text;
    }
  }

  // Textarea for input
  const textarea = new TextareaRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    backgroundColor: theme.surface0,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface0,
    focusedTextColor: theme.text,
    wrapMode: "word",
    placeholder: "Type your comment...",
    placeholderColor: theme.overlay,
    initialValue,
  });

  // Hint line
  const hint = new TextRenderable(renderer, {
    content: " [Ctrl+S] submit  [Esc] cancel",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
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

  // Guard against duplicate submit
  let submitted = false;

  // Key handler for Ctrl+Enter to submit and Esc to cancel
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    // Ctrl+S or Ctrl+Enter submits
    if (key.ctrl && (key.name === "s" || key.name === "return")) {
      key.preventDefault();
      key.stopPropagation();
      if (submitted) return;
      submitted = true;
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

import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  ScrollBoxRenderable,
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
  onResolve: () => void;
  onCancel: () => void;
}

export interface CommentInputOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

const MAX_CONTEXT_LENGTH = 80;

/**
 * Create a unified comment/thread overlay.
 * - New comment: just a text input
 * - Existing thread: scrollable conversation + reply input + resolve action
 *
 * Tab submits, Ctrl+R resolves, Esc cancels.
 */
export function createCommentInput(opts: CommentInputOptions): CommentInputOverlay {
  const { renderer, line, existingThread, onSubmit, onResolve, onCancel } = opts;

  const hasThread = existingThread && existingThread.messages.length > 0;
  const label = existingThread
    ? `Thread #${existingThread.id} (line ${line}) [${existingThread.status.toUpperCase()}]`
    : `New comment on line ${line}`;

  // Larger overlay for threads with conversation, smaller for new comments
  const overlayHeight = hasThread ? "80%" : 10;

  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: hasThread ? "5%" : "30%",
    left: "10%",
    width: "80%",
    height: overlayHeight,
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderComment,
    title: ` ${label} `,
    flexDirection: "column",
    padding: 1,
  });

  // Show full thread conversation in a scrollable area
  let scrollBox: ScrollBoxRenderable | null = null;
  if (hasThread) {
    scrollBox = new ScrollBoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexShrink: 1,
      scrollY: true,
      scrollX: false,
    });

    const lines: string[] = [];
    for (const msg of existingThread!.messages) {
      const authorLabel = msg.author === "reviewer" ? "You" : " AI";
      const tsStr = msg.ts ? new Date(msg.ts).toISOString().replace("T", " ").slice(0, 19) : "";
      const tsDisplay = tsStr ? ` [${tsStr}]` : "";
      lines.push(`${authorLabel}${tsDisplay}:`);
      for (const textLine of msg.text.split("\n")) {
        lines.push(`  ${textLine}`);
      }
      lines.push("");
    }

    const messageText = new TextRenderable(renderer, {
      content: lines.join("\n"),
      width: "100%",
      fg: theme.text,
      wrapMode: "word",
    });

    scrollBox.add(messageText);
    container.add(scrollBox);

    // Scroll to bottom to show latest message
    setTimeout(() => {
      scrollBox.scrollTo(scrollBox.scrollHeight);
      renderer.requestRender();
    }, 0);
  }

  // Separator between conversation and input
  if (hasThread) {
    const sep = new TextRenderable(renderer, {
      content: " Reply:",
      width: "100%",
      height: 1,
      fg: theme.subtext,
      wrapMode: "none",
    });
    container.add(sep);
  }

  const textarea = new TextareaRenderable(renderer, {
    width: "100%",
    height: hasThread ? 4 : undefined,
    flexGrow: hasThread ? 0 : 1,
    backgroundColor: theme.surface0,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface0,
    focusedTextColor: theme.text,
    wrapMode: "word",
    placeholder: hasThread ? "Type your reply..." : "Type your comment...",
    placeholderColor: theme.overlay,
    initialValue: "",
  });

  // Hint line — show resolve option only for existing threads
  const hintText = hasThread
    ? " [Tab] submit  [Ctrl+R] resolve  [Esc] cancel"
    : " [Tab] submit  [Esc] cancel";

  const hint = new TextRenderable(renderer, {
    content: hintText,
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(textarea);
  container.add(hint);

  // Focus textarea
  setTimeout(() => {
    textarea.focus();
    renderer.requestRender();
  }, 0);

  let submitted = false;

  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    // Tab submits
    if (key.name === "tab") {
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
    // Ctrl+R resolves thread (only for existing threads)
    if (key.ctrl && key.name === "r" && hasThread) {
      key.preventDefault();
      key.stopPropagation();
      onResolve();
      return;
    }
    // Ctrl+D / Ctrl+U scroll the conversation (only for threads with scroll)
    // Blur textarea first to prevent it from consuming Ctrl+U (line-clear)
    if (hasThread && scrollBox && key.ctrl && (key.name === "d" || key.name === "u")) {
      key.preventDefault();
      key.stopPropagation();
      textarea.blur();
      const scrollAmount = Math.max(1, Math.floor(scrollBox.visibleHeight / 2));
      if (key.name === "d") {
        scrollBox.scrollTo(scrollBox.scrollTop + scrollAmount);
      } else {
        scrollBox.scrollTo(Math.max(0, scrollBox.scrollTop - scrollAmount));
      }
      renderer.requestRender();
      setTimeout(() => { textarea.focus(); renderer.requestRender(); }, 0);
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

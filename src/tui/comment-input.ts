import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  ScrollBoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread, Message } from "../protocol/types";
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
  /** Update the conversation display with a new message (e.g., AI reply arrived) */
  addMessage: (msg: Message) => void;
  /** The thread ID this overlay is showing (null for new comments) */
  threadId: string | null;
}

const MAX_CONTEXT_LENGTH = 80;

function formatMessage(msg: Message): string {
  const authorLabel = msg.author === "reviewer" ? "You" : " AI";
  const tsStr = msg.ts ? new Date(msg.ts).toISOString().replace("T", " ").slice(0, 19) : "";
  const tsDisplay = tsStr ? ` [${tsStr}]` : "";
  const lines: string[] = [];
  lines.push(`${authorLabel}${tsDisplay}:`);
  for (const textLine of msg.text.split("\n")) {
    lines.push(`  ${textLine}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Create a unified comment/thread overlay.
 * - New comment: just a text input, Tab submits and closes
 * - Existing thread: scrollable conversation + reply input
 *   Tab submits reply but stays open. Esc closes.
 *   Live-updates when AI replies arrive via addMessage().
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
  let messageText: TextRenderable | null = null;
  let conversationContent = "";

  if (hasThread) {
    scrollBox = new ScrollBoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexShrink: 1,
      scrollY: true,
      scrollX: false,
    });

    // Build initial conversation content
    const parts: string[] = [];
    for (const msg of existingThread!.messages) {
      parts.push(formatMessage(msg));
    }
    conversationContent = parts.join("");

    messageText = new TextRenderable(renderer, {
      content: conversationContent,
      width: "100%",
      fg: theme.text,
      wrapMode: "word",
    });

    scrollBox.add(messageText);
    container.add(scrollBox);

    // Scroll to bottom to show latest message
    setTimeout(() => {
      if (scrollBox) {
        scrollBox.scrollTo(scrollBox.scrollHeight);
        renderer.requestRender();
      }
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

  // Hint line
  const hintText = hasThread
    ? " [Tab] reply  [Ctrl+R] resolve  [Esc] close"
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

  /** Append a message to the conversation display and scroll to bottom */
  function appendToConversation(msg: Message): void {
    if (!messageText || !scrollBox) return;
    conversationContent += formatMessage(msg);
    messageText.content = conversationContent;
    setTimeout(() => {
      if (scrollBox) {
        scrollBox.scrollTo(scrollBox.scrollHeight);
        renderer.requestRender();
      }
    }, 0);
  }

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
      const text = textarea.plainText.trim();
      if (text.length === 0) return; // ignore empty

      if (hasThread) {
        // Existing thread: submit reply, append to conversation, clear input, stay open
        onSubmit(text);
        appendToConversation({ author: "reviewer", text, ts: Date.now() });
        textarea.clear();
        textarea.focus();
        renderer.requestRender();
      } else {
        // New comment: submit and close
        onSubmit(text);
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
    // Ctrl+D / Ctrl+U scroll the conversation
    if (hasThread && scrollBox && key.ctrl && (key.name === "d" || key.name === "u")) {
      key.preventDefault();
      key.stopPropagation();
      const scrollAmount = Math.max(1, Math.floor(scrollBox.visibleHeight / 2));
      const currentScroll = scrollBox.scrollTop;
      if (key.name === "d") {
        scrollBox.scrollTo(currentScroll + scrollAmount);
      } else {
        scrollBox.scrollTo(Math.max(0, currentScroll - scrollAmount));
      }
      renderer.requestRender();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
    textarea.destroy();
  }

  return {
    container,
    cleanup,
    threadId: existingThread?.id ?? null,
    addMessage(msg: Message) {
      appendToConversation(msg);
    },
  };
}

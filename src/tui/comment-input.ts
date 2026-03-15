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
  addMessage: (msg: Message) => void;
  threadId: string | null;
}

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

export function createCommentInput(opts: CommentInputOptions): CommentInputOverlay {
  const { renderer, line, existingThread, onSubmit, onResolve, onCancel } = opts;
  const hasThread = existingThread && existingThread.messages.length > 0;

  // --- New comment: simple input, no history ---
  if (!hasThread) {
    return createNewComment(renderer, line, onSubmit, onCancel);
  }

  // --- Thread view: history on top, input on bottom ---
  return createThreadView(renderer, line, existingThread!, onSubmit, onResolve, onCancel);
}

function createNewComment(
  renderer: CliRenderer,
  line: number,
  onSubmit: (text: string) => void,
  onCancel: () => void,
): CommentInputOverlay {
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "30%",
    left: "10%",
    width: "80%",
    height: 10,
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderComment,
    title: ` New comment on line ${line} `,
    flexDirection: "column",
    padding: 1,
  });

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
    initialValue: "",
  });

  const hint = new TextRenderable(renderer, {
    content: " [Tab] submit  [Esc] cancel",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(textarea);
  container.add(hint);
  setTimeout(() => { textarea.focus(); renderer.requestRender(); }, 0);

  let submitted = false;
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault(); key.stopPropagation(); onCancel(); return;
    }
    if (key.name === "tab") {
      key.preventDefault(); key.stopPropagation();
      if (submitted) return;
      submitted = true;
      const text = textarea.plainText.trim();
      if (text.length > 0) onSubmit(text); else onCancel();
      return;
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  return {
    container,
    cleanup() { renderer.keyInput.off("keypress", keyHandler); textarea.destroy(); },
    addMessage() {},
    threadId: null,
  };
}

function createThreadView(
  renderer: CliRenderer,
  line: number,
  thread: Thread,
  onSubmit: (text: string) => void,
  onResolve: () => void,
  onCancel: () => void,
): CommentInputOverlay {
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "5%",
    left: "10%",
    width: "80%",
    height: "85%",
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderComment,
    title: ` Thread #${thread.id} (line ${line}) [${thread.status.toUpperCase()}] `,
    flexDirection: "column",
    padding: 1,
  });

  // --- Top: scrollable conversation history ---
  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
    stickyScroll: true,
    stickyStart: "bottom",
  });

  let conversationContent = "";
  for (const msg of thread.messages) {
    conversationContent += formatMessage(msg);
  }

  const messageText = new TextRenderable(renderer, {
    content: conversationContent,
    width: "100%",
    fg: theme.text,
    wrapMode: "word",
  });

  scrollBox.add(messageText);
  container.add(scrollBox);

  // --- Bottom: fixed input + hint ---
  const sep = new TextRenderable(renderer, {
    content: "\u2500".repeat(40),
    width: "100%",
    height: 1,
    fg: theme.surface1,
    wrapMode: "none",
  });
  container.add(sep);

  const textarea = new TextareaRenderable(renderer, {
    width: "100%",
    height: 4,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: theme.surface0,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface0,
    focusedTextColor: theme.text,
    wrapMode: "word",
    placeholder: "Type your reply...",
    placeholderColor: theme.overlay,
    initialValue: "",
  });
  container.add(textarea);

  const hint = new TextRenderable(renderer, {
    content: " [Tab] send  [Ctrl+R] resolve  [Ctrl+D/U] scroll  [Esc] close",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });
  container.add(hint);

  // Focus input
  setTimeout(() => { textarea.focus(); renderer.requestRender(); }, 0);

  function appendToConversation(msg: Message): void {
    conversationContent += formatMessage(msg);
    messageText.content = conversationContent;
    renderer.requestRender();
  }

  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault(); key.stopPropagation(); onCancel(); return;
    }
    if (key.name === "tab") {
      key.preventDefault(); key.stopPropagation();
      const text = textarea.plainText.trim();
      if (text.length === 0) return;
      onSubmit(text);
      appendToConversation({ author: "reviewer", text, ts: Date.now() });
      // Clear textarea
      textarea.selectAll();
      textarea.deleteChar();
      return;
    }
    if (key.ctrl && key.name === "r") {
      key.preventDefault(); key.stopPropagation(); onResolve(); return;
    }
    // Ctrl+D / Ctrl+U scroll conversation history
    if (key.ctrl && (key.name === "d" || key.name === "u")) {
      key.preventDefault(); key.stopPropagation();
      const amount = Math.max(1, Math.floor(scrollBox.visibleHeight / 2));
      if (key.name === "d") {
        scrollBox.scrollBy({ x: 0, y: amount });
      } else {
        scrollBox.scrollBy({ x: 0, y: -amount });
      }
      renderer.requestRender();
      return;
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  return {
    container,
    cleanup() { renderer.keyInput.off("keypress", keyHandler); textarea.destroy(); },
    threadId: thread.id,
    addMessage(msg: Message) { appendToConversation(msg); },
  };
}

import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread, Message } from "../protocol/types";
import { theme } from "./ui/theme";
import { createDialog } from "./ui/dialog";

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


export function createCommentInput(opts: CommentInputOptions): CommentInputOverlay {
  const { renderer, line, existingThread, onSubmit, onResolve, onCancel } = opts;
  // Always use thread view — even for new comments (empty history, just the input)
  const thread = existingThread ?? { id: "", line, status: "open" as const, messages: [] };
  return createThreadView(renderer, line, thread, onSubmit, onResolve, onCancel);
}

// --- Unified thread view: works for both new comments and existing threads ---
function createThreadView(
  renderer: CliRenderer,
  line: number,
  thread: Thread,
  onSubmit: (text: string) => void,
  onResolve: () => void,
  onCancel: () => void,
): CommentInputOverlay {
  const title = thread.id
    ? `Thread #${thread.id} (line ${line})`
    : `New comment on line ${line}`;

  const normalHints = [
    { key: "c", action: "reply" },
    { key: "r", action: "resolve" },
    { key: "Esc/q", action: "close" },
  ];
  const insertHints = [
    { key: "Tab", action: "send" },
    { key: "Esc", action: "back" },
  ];

  // --- State ---
  let mode: "normal" | "insert" = "insert";

  // Build the textarea now (we need it in the key handler closure)
  const textarea = new TextareaRenderable(renderer, {
    width: "100%",
    height: 4,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: theme.backgroundElement,
    textColor: theme.textDim,
    focusedBackgroundColor: theme.backgroundPanel,
    focusedTextColor: theme.text,
    wrapMode: "word",
    placeholder: "Press c to reply...",
    placeholderColor: theme.textDim,
    initialValue: "",
  });

  // Register our comprehensive key handler FIRST (before createDialog) so it
  // fires before the dialog's Esc handler and can stopPropagation in insert mode.
  const keyHandler = (key: KeyEvent) => {
    if (mode === "insert") {
      // --- INSERT MODE ---
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        enterNormal();
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        key.stopPropagation();
        const text = textarea.plainText.trim();
        if (text.length === 0) return;
        onSubmit(text);
        appendToConversation({ author: "reviewer", text, ts: Date.now() });
        textarea.selectAll();
        textarea.deleteChar();
        enterNormal();
        return;
      }
      // All other keys: let textarea handle them (don't preventDefault)
      return;
    }

    // --- NORMAL MODE (textarea blurred, all keys are ours) ---
    key.preventDefault();
    key.stopPropagation();

    switch (key.name) {
      case "escape":
      case "q":
        onCancel();
        return;

      case "c":
        enterInsert();
        return;

      case "r":
        onResolve();
        return;

      case "j":
      case "down":
        scrollBox.scrollBy({ x: 0, y: 1 });
        renderer.requestRender();
        return;

      case "k":
      case "up":
        scrollBox.scrollBy({ x: 0, y: -1 });
        renderer.requestRender();
        return;

      case "d":
        if (key.ctrl) {
          scrollBox.scrollBy({ x: 0, y: 5 });
          renderer.requestRender();
        }
        return;

      case "u":
        if (key.ctrl) {
          scrollBox.scrollBy({ x: 0, y: -5 });
          renderer.requestRender();
        }
        return;

      case "g":
        if (key.shift) {
          // G = go to bottom
          scrollBox.scrollTo(scrollBox.scrollHeight);
          renderer.requestRender();
        }
        // TODO: gg = go to top (needs double-tap tracking)
        return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  // Now create the dialog (its Esc handler registers after ours)
  // Pass no-op onDismiss — we handle all keys ourselves above.
  const dialog = createDialog({
    renderer,
    title,
    width: "80%",
    height: "85%",
    borderColor: theme.blue,
    onDismiss: onCancel,
    hints: insertHints,
  });

  // --- Scrollable conversation history ---
  const scrollBox = dialog.content;

  function renderMessage(msg: Message): BoxRenderable {
    const isReviewer = msg.author === "reviewer";
    const borderColor = isReviewer ? theme.blue : theme.green;
    const label = isReviewer ? "You" : "AI";
    const tsStr = msg.ts ? new Date(msg.ts).toISOString().replace("T", " ").slice(0, 19) : "";

    const msgBox = new BoxRenderable(renderer, {
      width: "100%",
      border: ["left"],
      borderColor,
      paddingLeft: 1,
      marginBottom: 1,
      flexDirection: "column",
    });

    // Header: author + timestamp
    const header = new TextRenderable(renderer, {
      content: tsStr ? `${label}  ${tsStr}` : label,
      width: "100%",
      height: 1,
      fg: theme.textMuted,
      wrapMode: "none",
    });
    msgBox.add(header);

    // Body: message text
    const body = new TextRenderable(renderer, {
      content: msg.text,
      width: "100%",
      fg: theme.text,
      wrapMode: "word",
    });
    msgBox.add(body);

    return msgBox;
  }

  for (const msg of thread.messages) {
    scrollBox.add(renderMessage(msg));
  }

  // --- Separator ---
  const sep = new TextRenderable(renderer, {
    content: "\u2500".repeat(40),
    width: "100%",
    height: 1,
    fg: theme.backgroundElement,
    wrapMode: "none",
  });
  dialog.container.add(sep);

  // --- Textarea (visible in both modes, focused only in insert) ---
  dialog.container.add(textarea);

  // --- Mode helpers (need dialog.setHints available) ---
  function enterInsert(): void {
    mode = "insert";
    textarea.focus();
    dialog.setHints(insertHints);
    renderer.requestRender();
  }

  function enterNormal(): void {
    mode = "normal";
    textarea.blur();
    dialog.setHints(normalHints);
    renderer.requestRender();
  }

  // Start in insert mode, scroll conversation to bottom
  setTimeout(() => {
    textarea.focus();
    scrollBox.scrollTo(scrollBox.scrollHeight);
    renderer.requestRender();
    setTimeout(() => {
      scrollBox.scrollTo(scrollBox.scrollHeight);
      renderer.requestRender();
    }, 50);
  }, 0);

  function appendToConversation(msg: Message): void {
    scrollBox.add(renderMessage(msg));
    renderer.requestRender();
    setTimeout(() => {
      scrollBox.scrollTo(scrollBox.scrollHeight);
      renderer.requestRender();
      setTimeout(() => {
        scrollBox.scrollTo(scrollBox.scrollHeight);
        renderer.requestRender();
      }, 50);
    }, 50);
  }

  return {
    container: dialog.container,
    cleanup() {
      renderer.keyInput.off("keypress", keyHandler);
      dialog.cleanup();
      textarea.destroy();
    },
    threadId: thread.id,
    addMessage(msg: Message) { appendToConversation(msg); },
  };
}

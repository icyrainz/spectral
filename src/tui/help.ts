import {
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { createDialog } from "./ui/dialog";

export interface HelpOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

function addHelpSection(container: ScrollBoxRenderable, renderer: CliRenderer, title: string, lines: string[]): void {
  // Blank line before section
  container.add(new TextRenderable(renderer, { content: "", width: "100%", height: 1, wrapMode: "none" }));
  // Section header in blue
  container.add(new TextRenderable(renderer, {
    content: `  ${title}`,
    width: "100%",
    height: 1,
    fg: theme.blue,
    wrapMode: "none",
  }));
  // Content lines
  for (const line of lines) {
    container.add(new TextRenderable(renderer, {
      content: line,
      width: "100%",
      height: 1,
      fg: theme.text,
      wrapMode: "none",
    }));
  }
}

/**
 * Create a help overlay popup showing all keybindings.
 * Dismissable with `?`, `q`, or `Esc`.
 */
export function createHelp(opts: {
  renderer: CliRenderer;
  version: string;
  onClose: () => void;
}): HelpOverlay {
  const { renderer, version, onClose } = opts;

  const dialog = createDialog({
    renderer,
    title: "Help",
    width: "60%",
    height: Math.min(34, renderer.height - 2),
    top: "10%",
    left: "20%",
    borderColor: theme.info,
    onDismiss: onClose,
    hints: [
      { key: "j/k", action: "navigate" },
      { key: "q/?/Esc", action: "close" },
    ],
  });

  // Version header
  dialog.content.add(new TextRenderable(renderer, { content: "", width: "100%", height: 1, wrapMode: "none" }));
  dialog.content.add(new TextRenderable(renderer, {
    content: `  revspec v${version}`,
    width: "100%",
    height: 1,
    fg: theme.textMuted,
    wrapMode: "none",
  }));

  addHelpSection(dialog.content, renderer, "Quick Start", [
    "  Navigate to a line and press c to comment.",
    "  The AI replies in real-time via the thread popup.",
    "  Press r to resolve threads, a to approve the spec.",
    "  Use :wq to save and quit when done reviewing.",
  ]);

  addHelpSection(dialog.content, renderer, "Thread Popup", [
    "  Opens in INSERT mode — type and press Tab to send.",
    "  Press Esc for NORMAL mode — scroll with j/k/gg/G,",
    "  c to reply, r to resolve, q to close.",
  ]);

  addHelpSection(dialog.content, renderer, "Navigation", [
    "  j/k       Down/up",
    "  gg/G      Top/bottom",
    "  Ctrl+d/u  Half page down/up",
    "  zz        Center cursor line",
    "  /         Search (smartcase)",
    "  n/N       Next/prev match",
    "  Esc       Clear search",
    "  ]t/[t     Next/prev thread",
    "  ]r/[r     Next/prev unread",
  ]);

  addHelpSection(dialog.content, renderer, "Review", [
    "  c         Comment / view thread",
    "  r         Resolve thread (toggle)",
    "  R         Resolve all pending",
    "  dd        Delete thread",
    "  T         List threads",
    "  S         Submit for rewrite",
    "  A         Approve spec",
  ]);

  addHelpSection(dialog.content, renderer, "Commands", [
    "  :q        Quit (warns if unresolved)",
    "  :q!       Force quit",
    "  :{N}      Jump to line N",
    "  Ctrl+C    Force quit",
  ]);

  // Trailing blank line
  dialog.content.add(new TextRenderable(renderer, { content: "", width: "100%", height: 1, wrapMode: "none" }));

  let pendingG: ReturnType<typeof setTimeout> | null = null;

  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "q" || key.sequence === "?") {
      key.preventDefault();
      key.stopPropagation();
      if (pendingG) { clearTimeout(pendingG); pendingG = null; }
      onClose();
      return;
    }
    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      dialog.content.scrollTo(Math.min(dialog.content.scrollTop + 1, dialog.content.scrollHeight));
      renderer.requestRender();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      dialog.content.scrollTo(Math.max(dialog.content.scrollTop - 1, 0));
      renderer.requestRender();
      return;
    }
    // G = goto bottom
    if (key.name === "g" && key.shift) {
      key.preventDefault();
      key.stopPropagation();
      if (pendingG) { clearTimeout(pendingG); pendingG = null; }
      dialog.content.scrollTo(dialog.content.scrollHeight);
      renderer.requestRender();
      return;
    }
    // gg = goto top
    if (key.name === "g" && !key.shift && !key.ctrl) {
      key.preventDefault();
      key.stopPropagation();
      if (pendingG) {
        clearTimeout(pendingG);
        pendingG = null;
        dialog.content.scrollTo(0);
        renderer.requestRender();
      } else {
        pendingG = setTimeout(() => { pendingG = null; }, 300);
      }
      return;
    }
    // Ctrl+D = half page down
    if (key.ctrl && key.name === "d") {
      key.preventDefault();
      key.stopPropagation();
      const half = Math.max(1, Math.floor((renderer.height - 4) / 2));
      dialog.content.scrollTo(Math.min(dialog.content.scrollTop + half, dialog.content.scrollHeight));
      renderer.requestRender();
      return;
    }
    // Ctrl+U = half page up
    if (key.ctrl && key.name === "u") {
      key.preventDefault();
      key.stopPropagation();
      const half = Math.max(1, Math.floor((renderer.height - 4) / 2));
      dialog.content.scrollTo(Math.max(dialog.content.scrollTop - half, 0));
      renderer.requestRender();
      return;
    }
  };

  renderer.keyInput.on("keypress", extraKeyHandler);

  return {
    container: dialog.container,
    cleanup() {
      if (pendingG) clearTimeout(pendingG);
      dialog.cleanup();
      renderer.keyInput.off("keypress", extraKeyHandler);
    },
  };
}

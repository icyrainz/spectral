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
    height: Math.min(26, renderer.height - 2),
    top: "10%",
    left: "20%",
    borderColor: theme.info,
    onDismiss: onClose,
    hints: [
      { key: "q/?/Esc", action: "close" },
      { key: "j/k", action: "scroll" },
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

  addHelpSection(dialog.content, renderer, "Navigation", [
    "  j/k       Down/up",
    "  gg        Go to first line / scroll to top",
    "  G         Go to last line / scroll to bottom",
    "  Ctrl+d/u  Half page down/up",
    "  /         Search",
    "  n/N       Next/prev search match",
    "  Esc       Clear search highlights",
    "  ]t/[t     Next/prev thread",
    "  ]r/[r     Next/prev unread thread",
  ]);

  addHelpSection(dialog.content, renderer, "Review", [
    "  c         Comment / view thread / reply",
    "  r         Resolve thread",
    "  R         Resolve all pending",
    "  dd        Delete draft comment (double-tap)",
    "  l         List threads",
    "  a         Approve spec",
  ]);

  addHelpSection(dialog.content, renderer, "Commands", [
    "  :w        Show save status",
    "  :q        Quit (blocks if unsaved)",
    "  :wq       Save and quit",
    "  :q!       Quit without saving",
  ]);

  // Trailing blank line
  dialog.content.add(new TextRenderable(renderer, { content: "", width: "100%", height: 1, wrapMode: "none" }));

  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "q" || key.sequence === "?") {
      key.preventDefault();
      key.stopPropagation();
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

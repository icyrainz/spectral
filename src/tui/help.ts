import {
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { createDialog } from "./ui/dialog";

export interface HelpOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
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

  const helpText = [
    "",
    `  revspec v${version}`,
    "",
    "  Navigation",
    "  j/k       Down/up",
    "  gg        Go to first line / scroll to top",
    "  G         Go to last line / scroll to bottom",
    "  Ctrl+d/u  Half page down/up",
    "  /         Search",
    "  n/N       Next/prev search match",
    "  Esc       Clear search highlights",
    "  ]t/[t     Next/prev thread",
    "  ]r/[r     Next/prev unread thread",
    "",
    "  Review",
    "  c         Comment / view thread / reply",
    "  r         Resolve thread",
    "  R         Resolve all pending",
    "  dd        Delete draft comment (double-tap)",
    "  l         List threads",
    "  a         Approve spec",
    "",
    "  Commands",
    "  :w        Show save status",
    "  :q        Save and quit",
    "  :wq       Save and quit",
    "  :q!       Quit without saving",
    "",
  ].join("\n");

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

  const content = new TextRenderable(renderer, {
    content: helpText,
    width: "100%",
    fg: theme.text,
    wrapMode: "none",
  });

  dialog.content.add(content);

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
      dialog.content.scrollBy(1);
      renderer.requestRender();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      dialog.content.scrollBy(-1);
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

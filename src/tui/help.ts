import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./theme";

export interface HelpOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

/**
 * Create a help overlay popup showing all keybindings.
 * Dismissable with `?` or `Esc`.
 */
export function createHelp(opts: {
  renderer: CliRenderer;
  onClose: () => void;
}): HelpOverlay {
  const { renderer, onClose } = opts;

  const helpText = [
    "",
    "  Navigation",
    "  j/k       Scroll up/down",
    "  Space/b   Page down/up",
    "  n/N       Next/prev thread",
    "  ]c/[c     Next/prev comment",
    "  /         Search",
    "",
    "  Review",
    "  c         Add comment / reply",
    "  e         Expand thread",
    "  r         Resolve thread",
    "  R         Resolve all pending",
    "  d         Delete draft comment",
    "  l         List threads",
    "  a         Approve spec",
    "",
    "  Commands",
    "  :w        Save draft",
    "  :q        Submit and quit",
    "  :wq       Save and quit",
    "  :q!       Quit without saving",
    "",
  ].join("\n");

  // Overlay container - centered popup
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "10%",
    left: "20%",
    width: "60%",
    height: 24,
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderThread,
    title: " Help ",
    flexDirection: "column",
    padding: 0,
  });

  const content = new TextRenderable(renderer, {
    content: helpText,
    width: "100%",
    flexGrow: 1,
    fg: theme.text,
    wrapMode: "none",
  });

  const hint = new TextRenderable(renderer, {
    content: " [?/Esc] close",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(content);
  container.add(hint);

  // Key handler
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape" || key.sequence === "?") {
      key.preventDefault();
      key.stopPropagation();
      onClose();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, cleanup };
}

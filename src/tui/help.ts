import {
  BoxRenderable,
  ScrollBoxRenderable,
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
    "  j/k       Down/up",
    "  gg        Go to first line / scroll to top",
    "  G         Go to last line / scroll to bottom",
    "  Ctrl+d/u  Half page down/up",
    "  /         Search",
    "  n/N       Next/prev search match",
    "  ]t/[t     Next/prev thread",
    "",
    "  View",
    "  m         Toggle markdown / line mode",
    "",
    "  Review (switches to line mode)",
    "  c         Comment / view thread / reply",
    "  r         Resolve thread",
    "  R         Resolve all pending",
    "  dd        Delete draft comment (double-tap)",
    "  l         List threads",
    "  a         Approve spec",
    "",
    "  Commands",
    "  :w        Save draft",
    "  :q        Quit (blocks if unsaved)",
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
    height: 26,
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderThread,
    title: " Help ",
    flexDirection: "column",
    padding: 0,
  });

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
    backgroundColor: theme.base,
  });

  const content = new TextRenderable(renderer, {
    content: helpText,
    width: "100%",
    fg: theme.text,
    wrapMode: "none",
  });

  scrollBox.add(content);

  const hint = new TextRenderable(renderer, {
    content: " [q/?/Esc] close  [j/k] scroll",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(scrollBox);
  container.add(hint);

  // Key handler
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape" || key.name === "q" || key.sequence === "?") {
      key.preventDefault();
      key.stopPropagation();
      onClose();
      return;
    }
    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      scrollBox.scrollBy(1);
      renderer.requestRender();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      scrollBox.scrollBy(-1);
      renderer.requestRender();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, cleanup };
}

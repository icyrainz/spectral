import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./theme";
import { buildHints, type Hint } from "./hint-bar";

export interface DialogOptions {
  renderer: CliRenderer;
  title: string;
  width?: string | number;
  height?: string | number;
  top?: string | number;
  left?: string | number;
  borderColor?: string;
  onDismiss: () => void;
  hints?: Hint[];
}

export interface DialogComponents {
  container: BoxRenderable;
  content: ScrollBoxRenderable;
  hintText: TextRenderable;
  setHints: (hints: Hint[]) => void;
  cleanup: () => void;
}

export function createDialog(opts: DialogOptions): DialogComponents {
  const {
    renderer, title, onDismiss,
    width = "80%", height = "85%",
    top = "5%", left = "10%",
    borderColor = theme.border,
    hints = [],
  } = opts;

  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top,
    left,
    width,
    height,
    zIndex: 100,
    backgroundColor: theme.backgroundPanel,
    border: true,
    borderStyle: "single",
    borderColor,
    title: ` ${title} `,
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });

  const content = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
  });
  container.add(content);

  const hintBox = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
    backgroundColor: theme.backgroundElement,
  });
  const hintText = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    fg: theme.textMuted,
    wrapMode: "none",
    truncate: true,
  });
  hintBox.add(hintText);
  container.add(hintBox);

  if (hints.length > 0) {
    buildHints(hintText, hints);
  }

  function setHints(newHints: Hint[]): void {
    buildHints(hintText, newHints);
    renderer.requestRender();
  }

  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      key.preventDefault();
      key.stopPropagation();
      onDismiss();
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, content, hintText, setHints, cleanup };
}

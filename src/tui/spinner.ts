import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./ui/theme";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

export function createSpinner(opts: {
  renderer: CliRenderer;
  message: string;
  timeoutMs?: number;
  onCancel: () => void;
  onTimeout: () => void;
}): SpinnerOverlay {
  const { renderer, message, onCancel, onTimeout, timeoutMs = 120_000 } = opts;

  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "40%",
    left: "25%",
    width: "50%",
    height: 5,
    zIndex: 100,
    backgroundColor: theme.backgroundPanel,
    border: true,
    borderStyle: "single",
    borderColor: theme.blue,
    title: " Submitting ",
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    alignItems: "center",
  });

  const text = new TextRenderable(renderer, {
    content: `${SPINNER_FRAMES[0]} ${message}`,
    width: "100%",
    height: 1,
    fg: theme.text,
    wrapMode: "none",
  });
  container.add(text);

  let frame = 0;
  const spinInterval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    text.content = `${SPINNER_FRAMES[frame]} ${message}`;
    renderer.requestRender();
  }, 80);

  const timeout = setTimeout(() => {
    onTimeout();
  }, timeoutMs);

  const keyHandler = (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  return {
    container,
    cleanup() {
      clearInterval(spinInterval);
      clearTimeout(timeout);
      renderer.keyInput.off("keypress", keyHandler);
    },
  };
}

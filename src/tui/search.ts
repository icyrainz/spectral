import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "./ui/theme";

export interface SearchOptions {
  renderer: CliRenderer;
  specLines: string[];
  cursorLine: number;
  onResult: (lineNumber: number, query: string) => void;
  onPreview?: (query: string | null) => void;
  onCancel: () => void;
}

export interface SearchOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

/**
 * Create a search overlay at the bottom of the screen.
 * On Enter: search forward from cursorLine, wrapping around.
 * On Escape: cancel.
 */
export function createSearch(opts: SearchOptions): SearchOverlay {
  const { renderer, specLines, cursorLine, onResult, onCancel } = opts;

  // Container bar at bottom
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    zIndex: 100,
    backgroundColor: theme.backgroundPanel,
    flexDirection: "row",
    alignItems: "center",
  });

  // Search label
  const label = new TextRenderable(renderer, {
    content: " / ",
    width: 3,
    height: 1,
    fg: theme.yellow,
    bg: theme.backgroundPanel,
    wrapMode: "none",
  });

  // Search input
  const input = new InputRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    backgroundColor: theme.backgroundPanel,
    textColor: theme.text,
    focusedBackgroundColor: theme.backgroundElement,
    focusedTextColor: theme.text,
    placeholder: "Search...",
    placeholderColor: theme.textDim,
  });

  container.add(label);
  container.add(input);

  // Focus the input after mount (same pattern as comment-input)
  setTimeout(() => {
    input.focus();
    renderer.requestRender();
  }, 0);

  // Incremental search — preview highlights after 3+ characters
  if (opts.onPreview) {
    input.on(InputRenderableEvents.INPUT, () => {
      const raw = input.value.trim();
      opts.onPreview!(raw.length >= 3 ? raw : null);
    });
  }

  // Key handler
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    if (key.name === "return") {
      key.preventDefault();
      key.stopPropagation();
      const raw = input.value.trim();
      if (raw.length === 0) {
        onCancel();
        return;
      }

      // Smartcase: if query has any uppercase, case-sensitive; otherwise case-insensitive
      const caseSensitive = raw !== raw.toLowerCase();
      const query = caseSensitive ? raw : raw.toLowerCase();

      // Search forward from cursor, wrapping around
      const total = specLines.length;
      for (let offset = 1; offset <= total; offset++) {
        const i = (cursorLine - 1 + offset) % total;
        const line = caseSensitive ? specLines[i] : specLines[i].toLowerCase();
        if (line.includes(query)) {
          onResult(i + 1, raw); // 1-based line number + original query (preserves case for n/N)
          return;
        }
      }

      // No match found — show feedback in the input placeholder, keep search open
      input.placeholder = "No match";
      input.placeholderColor = theme.red;
      input.value = "";
      renderer.requestRender();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
    input.destroy();
  }

  return { container, cleanup };
}

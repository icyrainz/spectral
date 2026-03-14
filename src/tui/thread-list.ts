import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread } from "../protocol/types";
import { theme, STATUS_ICONS } from "./theme";

export interface ThreadListOptions {
  renderer: CliRenderer;
  threads: Thread[];
  onSelect: (lineNumber: number) => void;
  onCancel: () => void;
}

export interface ThreadListOverlay {
  container: BoxRenderable;
  cleanup: () => void;
}

const MAX_PREVIEW_LENGTH = 50;

function previewText(thread: Thread): string {
  if (thread.messages.length === 0) return "(empty)";
  const last = thread.messages[thread.messages.length - 1];
  const text = last.text.replace(/\n/g, " ");
  if (text.length <= MAX_PREVIEW_LENGTH) return text;
  return text.slice(0, MAX_PREVIEW_LENGTH - 1) + "\u2026";
}

/**
 * Create a thread list overlay showing open/pending threads.
 * Select + Enter: jump to that thread's line.
 * Escape: cancel.
 */
export function createThreadList(opts: ThreadListOptions): ThreadListOverlay {
  const { renderer, threads, onSelect, onCancel } = opts;

  // Filter to active threads (open/pending)
  const activeThreads = threads.filter(
    (t) => t.status === "open" || t.status === "pending"
  );

  // Overlay container
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top: "15%",
    left: "15%",
    width: "70%",
    height: "60%",
    zIndex: 100,
    backgroundColor: theme.base,
    border: true,
    borderStyle: "single",
    borderColor: theme.borderList,
    title: ` Threads (${activeThreads.length} active) `,
    flexDirection: "column",
    padding: 1,
  });

  if (activeThreads.length === 0) {
    const emptyMsg = new TextRenderable(renderer, {
      content: "No active threads. Press [Esc] to close.",
      width: "100%",
      height: 1,
      fg: theme.overlay,
      wrapMode: "none",
    });
    container.add(emptyMsg);
  } else {
    // Build select options from threads
    const selectOptions = activeThreads.map((t) => {
      const icon = STATUS_ICONS[t.status];
      return {
        name: `${icon} #${t.id} line ${t.line}: ${previewText(t)}`,
        description: `${t.status} - ${t.messages.length} message(s)`,
        value: t.line,
      };
    });

    const select = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      options: selectOptions,
      selectedIndex: 0,
      backgroundColor: theme.base,
      textColor: theme.text,
      focusedBackgroundColor: theme.base,
      focusedTextColor: theme.text,
      selectedBackgroundColor: theme.surface1,
      selectedTextColor: "#f5c2e7",
      descriptionColor: theme.overlay,
      selectedDescriptionColor: theme.subtext,
      showDescription: true,
      wrapSelection: true,
    });

    container.add(select);

    // Focus the select so it handles j/k navigation
    renderer.focusRenderable(select);

    // Listen for item selection (Enter key)
    select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const selected = select.getSelectedOption();
      if (selected && selected.value != null) {
        onSelect(selected.value as number);
      }
    });
  }

  // Hint bar
  const hint = new TextRenderable(renderer, {
    content: " [j/k] navigate  [Enter] jump  [Esc] close",
    width: "100%",
    height: 1,
    fg: theme.hintFg,
    bg: theme.hintBg,
    wrapMode: "none",
    truncate: true,
  });

  container.add(hint);

  // Key handler for Esc
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
  };

  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, cleanup };
}

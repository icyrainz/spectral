import {
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import type { Thread } from "../protocol/types";
import { theme, STATUS_ICONS } from "./ui/theme";
import { createDialog } from "./ui/dialog";

export interface ThreadListOptions {
  renderer: CliRenderer;
  threads: Thread[];
  onSelect: (lineNumber: number) => void;
  onCancel: () => void;
}

export interface ThreadListOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

const MAX_PREVIEW_LENGTH = 50;

function previewText(thread: Thread): string {
  if (thread.messages.length === 0) return "(empty)";
  const last = thread.messages[0];
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

  const count = activeThreads.length;

  const dialog = createDialog({
    renderer,
    title: `Threads (${count} active)`,
    width: "70%",
    height: "60%",
    top: "15%",
    left: "15%",
    borderColor: theme.mauve,
    onDismiss: onCancel,
    hints: [
      { key: "j/k", action: "navigate" },
      { key: "Enter", action: "jump" },
      { key: "Esc", action: "close" },
    ],
  });

  if (activeThreads.length === 0) {
    const emptyMsg = new TextRenderable(renderer, {
      content: "No active threads. Press [Esc] to close.",
      width: "100%",
      height: 1,
      fg: theme.textDim,
      wrapMode: "none",
    });
    dialog.content.add(emptyMsg);
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
      backgroundColor: theme.backgroundPanel,
      textColor: theme.text,
      focusedBackgroundColor: theme.backgroundPanel,
      focusedTextColor: theme.text,
      selectedBackgroundColor: theme.backgroundElement,
      selectedTextColor: "#f5c2e7",
      descriptionColor: theme.textDim,
      selectedDescriptionColor: theme.textMuted,
      showDescription: true,
      wrapSelection: true,
    });

    dialog.content.add(select);

    // Focus the select so it handles j/k navigation and Enter selection
    setTimeout(() => {
      renderer.focusRenderable(select);
      renderer.requestRender();
    }, 0);

    // Listen for item selection (Enter key)
    select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const selected = select.getSelectedOption();
      if (selected && selected.value != null) {
        onSelect(selected.value as number);
      }
    });
  }

  return {
    container: dialog.container,
    cleanup: dialog.cleanup,
  };
}

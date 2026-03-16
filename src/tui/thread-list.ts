import {
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import type { Thread } from "../protocol/types";
import { theme, STATUS_ICONS } from "./ui/theme";
import { createDialog } from "./ui/dialog";
import { THREAD_LIST_HINTS } from "./ui/keymap";

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

type FilterMode = "all" | "active" | "resolved";
const FILTER_CYCLE: FilterMode[] = ["all", "active", "resolved"];

function previewText(thread: Thread): string {
  if (thread.messages.length === 0) return "(empty)";
  const first = thread.messages[0];
  const text = first.text.replace(/\n/g, " ");
  if (text.length <= MAX_PREVIEW_LENGTH) return text;
  return text.slice(0, MAX_PREVIEW_LENGTH - 1) + "\u2026";
}

function filterThreads(threads: Thread[], mode: FilterMode): Thread[] {
  switch (mode) {
    case "active":
      return threads.filter((t) => t.status === "open" || t.status === "pending");
    case "resolved":
      return threads.filter((t) => t.status === "resolved");
    case "all":
    default:
      return threads;
  }
}

function buildTitle(threads: Thread[], mode: FilterMode): string {
  const activeCount = threads.filter(
    (t) => t.status === "open" || t.status === "pending"
  ).length;
  const total = threads.length;
  const label = mode === "all" ? "all" : mode;
  return `Threads (${activeCount} active, ${total} total) [${label}]`;
}

function threadsToOptions(threads: Thread[]) {
  return threads.map((t) => {
    const icon = STATUS_ICONS[t.status];
    return {
      name: `${icon} #${t.id} line ${t.line}: ${previewText(t)}`,
      description: `${t.status} - ${t.messages.length} message(s)`,
      value: t.line,
    };
  });
}

/**
 * Create a thread list overlay showing all threads.
 * Select + Enter: jump to that thread's line.
 * Ctrl+F: cycle filter (all → active → resolved).
 * Escape: cancel.
 */
export function createThreadList(opts: ThreadListOptions): ThreadListOverlay {
  const { renderer, threads, onSelect, onCancel } = opts;

  // Exclude outdated threads from the pool
  const allThreads = threads.filter(
    (t) => t.status === "open" || t.status === "pending" || t.status === "resolved"
  );

  let filterIndex = 0;
  let currentFilter: FilterMode = FILTER_CYCLE[0];
  let filtered = filterThreads(allThreads, currentFilter);

  const dialog = createDialog({
    renderer,
    title: buildTitle(allThreads, currentFilter),
    width: "56%",
    height: "50%",
    top: "20%",
    left: "22%",
    borderColor: theme.blue,
    onDismiss: onCancel,
    hints: THREAD_LIST_HINTS,
  });

  const emptyMsg = new TextRenderable(renderer, {
    content: "No threads. Press [Esc] to close.",
    width: "100%",
    height: 1,
    fg: theme.textDim,
    wrapMode: "none",
    visible: filtered.length === 0,
  });
  dialog.content.add(emptyMsg);

  const select = new SelectRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    options: threadsToOptions(filtered),
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
    visible: filtered.length > 0,
  });
  dialog.content.add(select);

  if (filtered.length > 0) {
    setTimeout(() => {
      renderer.focusRenderable(select);
      renderer.requestRender();
    }, 0);
  }

  function applyFilter(): void {
    filtered = filterThreads(allThreads, currentFilter);
    dialog.container.title = ` ${buildTitle(allThreads, currentFilter)} `;
    select.options = threadsToOptions(filtered);
    select.visible = filtered.length > 0;
    emptyMsg.visible = filtered.length === 0;
    if (filtered.length === 0) {
      emptyMsg.content = `No ${currentFilter === "all" ? "" : currentFilter + " "}threads. Press [Ctrl+f] to change filter.`;
    }
    if (filtered.length > 0) {
      setTimeout(() => {
        renderer.focusRenderable(select);
        renderer.requestRender();
      }, 0);
    }
    renderer.requestRender();
  }

  // SelectRenderable ITEM_SELECTED event
  select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
    const selected = select.getSelectedOption();
    if (selected && selected.value != null) {
      onSelect(selected.value as number);
    }
  });

  // Manual key handler — SelectRenderable focus is unreliable
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
    // Ctrl+F: cycle filter
    if (key.ctrl && key.name === "f") {
      key.preventDefault();
      key.stopPropagation();
      filterIndex = (filterIndex + 1) % FILTER_CYCLE.length;
      currentFilter = FILTER_CYCLE[filterIndex];
      applyFilter();
      return;
    }
    if (filtered.length === 0) return;
    if (key.name === "return") {
      key.preventDefault();
      key.stopPropagation();
      const selected = select.getSelectedOption();
      if (selected && selected.value != null) {
        onSelect(selected.value as number);
      }
      return;
    }
    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      select.moveDown();
      renderer.requestRender();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      select.moveUp();
      renderer.requestRender();
      return;
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  return {
    container: dialog.container,
    cleanup() {
      dialog.cleanup();
      renderer.keyInput.off("keypress", keyHandler);
    },
  };
}

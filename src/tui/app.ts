import { readFileSync } from "fs";
import {
  createCliRenderer,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { readReviewFile, readDraftFile } from "../protocol/read";
import { writeDraftFile } from "../protocol/write";
import { mergeDraftIntoReview } from "../protocol/merge";
import type { Thread } from "../protocol/types";
import { ReviewState } from "../state/review-state";
import { buildPagerContent, createPager, type PagerComponents } from "./pager";
import {
  buildTopBarText,
  buildBottomBarText,
  createTopBar,
  createBottomBar,
  type TopBarComponents,
  type BottomBarComponents,
} from "./status-bar";
import { createCommentInput } from "./comment-input";
import { createThreadExpand } from "./thread-expand";
import { createSearch } from "./search";
import { createThreadList } from "./thread-list";
import { createConfirm } from "./confirm";

export async function runTui(
  specFile: string,
  reviewPath: string,
  draftPath: string
): Promise<void> {
  // 1. Read spec file into lines
  const specContent = readFileSync(specFile, "utf8");
  const specLines = specContent.split("\n");

  // 2. Load existing review + draft, merge threads
  const existingReview = readReviewFile(reviewPath);
  const existingDraft = readDraftFile(draftPath);

  let threads: Thread[] = [];
  if (existingReview) {
    threads = existingReview.threads.map((t) => ({
      ...t,
      messages: [...t.messages],
    }));
  }
  if (existingDraft && existingDraft.threads) {
    // Merge draft threads into review threads
    const merged = mergeDraftIntoReview(existingReview, existingDraft, specFile);
    threads = merged.threads;
  }

  // 3. Create ReviewState
  const state = new ReviewState(specLines, threads);

  // 4. Create renderer
  const renderer = await createCliRenderer({
    useAlternateScreen: true,
    exitOnCtrlC: false,
    useMouse: false,
  });

  // 5. Build layout: top bar, pager, bottom bar in a column
  const rootBox = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
  });

  const topBar: TopBarComponents = createTopBar(renderer);
  const pager: PagerComponents = createPager(renderer);
  const bottomBar: BottomBarComponents = createBottomBar(renderer);

  rootBox.add(topBar.bar);
  rootBox.add(pager.scrollBox);
  rootBox.add(bottomBar.bar);

  renderer.root.add(rootBox);

  // 6. Initial render
  function refreshPager(): void {
    const content = buildPagerContent(state);
    pager.textNode.content = content;
    topBar.bar.content = buildTopBarText(specFile, state);
    bottomBar.bar.content = buildBottomBarText(commandBuffer, showHelp);
    renderer.requestRender();
  }

  // Command mode state
  let commandBuffer: string | null = null;
  let showHelp = false;

  // Overlay state — when an overlay is active, normal keybindings are blocked.
  // The overlay's own key handlers manage its lifecycle.
  type ActiveOverlay = {
    container: BoxRenderable;
    cleanup: () => void;
  } | null;
  let activeOverlay: ActiveOverlay = null;

  // Helper: dismiss the current overlay and return to normal mode
  function dismissOverlay(): void {
    if (activeOverlay) {
      activeOverlay.cleanup();
      renderer.root.remove(activeOverlay.container.id);
      activeOverlay = null;
      refreshPager();
    }
  }

  // Helper: show an overlay
  function showOverlay(overlay: { container: BoxRenderable; cleanup: () => void }): void {
    activeOverlay = overlay;
    renderer.root.add(overlay.container);
    renderer.requestRender();
  }

  // Helper: save draft file
  function saveDraft(): void {
    const draft = state.toDraft();
    writeDraftFile(draftPath, draft);
  }

  // Helper: scroll pager to ensure cursor line is visible
  function ensureCursorVisible(): void {
    // Each line in the pager is 1 row of text.
    // The cursor line index (0-based) in the pager is (state.cursorLine - 1).
    const cursorRow = state.cursorLine - 1;
    const viewportHeight = Math.max(1, renderer.height - 2); // minus top + bottom bar

    const currentScroll = pager.scrollBox.scrollTop;
    if (cursorRow < currentScroll) {
      pager.scrollBox.scrollTo(cursorRow);
    } else if (cursorRow >= currentScroll + viewportHeight) {
      pager.scrollBox.scrollTo(cursorRow - viewportHeight + 1);
    }
  }

  // Helper: get page size (terminal height minus bars)
  function pageSize(): number {
    return Math.max(1, renderer.height - 4);
  }

  // Process command buffer input
  function processCommand(cmd: string, resolve: () => void): boolean {
    if (cmd === "w") {
      saveDraft();
      return false; // don't exit
    }
    if (cmd === "q") {
      // Show confirm dialog if there are pending comments
      const { open, pending } = state.activeThreadCount();
      const total = open + pending;
      if (total > 0) {
        showConfirmQuit(resolve);
        return false;
      }
      saveDraft();
      return true; // exit
    }
    if (cmd === "q!") {
      return true; // exit without saving
    }
    return false; // unknown command, ignore
  }

  // --- Overlay launchers ---

  function showCommentInput(): void {
    const existingThread = state.threadAtLine(state.cursorLine);
    const overlay = createCommentInput({
      renderer,
      line: state.cursorLine,
      existingThread,
      onSubmit: (text: string) => {
        if (existingThread) {
          state.replyToThread(existingThread.id, text);
        } else {
          state.addComment(state.cursorLine, text);
        }
        dismissOverlay();
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  function showThreadExpandOverlay(): void {
    const thread = state.threadAtLine(state.cursorLine);
    if (!thread) return;

    const overlay = createThreadExpand({
      renderer,
      thread,
      onResolve: () => {
        state.resolveThread(thread.id);
        dismissOverlay();
      },
      onContinue: () => {
        // Close expand overlay, then open comment input as reply
        dismissOverlay();
        showCommentInput();
      },
      onClose: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  function showSearchOverlay(): void {
    const overlay = createSearch({
      renderer,
      specLines: state.specLines,
      cursorLine: state.cursorLine,
      onResult: (lineNumber: number) => {
        state.cursorLine = lineNumber;
        dismissOverlay();
        ensureCursorVisible();
        refreshPager();
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  function showThreadListOverlay(): void {
    const overlay = createThreadList({
      renderer,
      threads: state.threads,
      onSelect: (lineNumber: number) => {
        state.cursorLine = lineNumber;
        dismissOverlay();
        ensureCursorVisible();
        refreshPager();
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  function showConfirmQuit(resolve: () => void): void {
    const { open, pending } = state.activeThreadCount();
    const total = open + pending;
    const overlay = createConfirm({
      renderer,
      message: `Submit ${total} active thread(s) and quit? [y/n]`,
      onConfirm: () => {
        dismissOverlay();
        saveDraft();
        renderer.destroy();
        resolve();
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  refreshPager();
  renderer.start();

  // 7. Set up keybinding handler
  return new Promise<void>((resolve) => {
    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      // If an overlay is active, only handle Ctrl+C to force dismiss.
      // All other keys pass through to the overlay's own handlers
      // (e.g., TextareaRenderable for typing in comment input).
      if (activeOverlay) {
        if (key.ctrl && key.name === "c") {
          dismissOverlay();
          return;
        }
        // Don't block — let the key propagate to focused renderables
        return;
      }

      // If in command mode, buffer keypresses
      if (commandBuffer !== null) {
        if (key.name === "return") {
          const cmd = commandBuffer;
          commandBuffer = null;
          const shouldExit = processCommand(cmd, resolve);
          if (shouldExit) {
            renderer.destroy();
            resolve();
            return;
          }
          refreshPager();
          return;
        }
        if (key.name === "escape") {
          commandBuffer = null;
          refreshPager();
          return;
        }
        if (key.name === "backspace") {
          if (commandBuffer.length > 0) {
            commandBuffer = commandBuffer.slice(0, -1);
          } else {
            commandBuffer = null;
          }
          refreshPager();
          return;
        }
        // Append printable characters
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          commandBuffer += key.sequence;
          refreshPager();
        }
        return;
      }

      // Ctrl+C to exit
      if (key.ctrl && key.name === "c") {
        renderer.destroy();
        resolve();
        return;
      }

      // Normal mode keybindings
      switch (key.name) {
        case "j":
        case "down": {
          if (state.cursorLine < state.lineCount) {
            state.cursorLine++;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "k":
        case "up": {
          if (state.cursorLine > 1) {
            state.cursorLine--;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "space": {
          const newLine = Math.min(
            state.cursorLine + pageSize(),
            state.lineCount
          );
          state.cursorLine = newLine;
          ensureCursorVisible();
          refreshPager();
          break;
        }
        case "b": {
          const newLine = Math.max(state.cursorLine - pageSize(), 1);
          state.cursorLine = newLine;
          ensureCursorVisible();
          refreshPager();
          break;
        }
        case "n": {
          if (!key.shift) {
            const next = state.nextActiveThread();
            if (next !== null) {
              state.cursorLine = next;
              ensureCursorVisible();
              refreshPager();
            }
          } else {
            // Shift+N = prev thread (uppercase N)
            const prev = state.prevActiveThread();
            if (prev !== null) {
              state.cursorLine = prev;
              ensureCursorVisible();
              refreshPager();
            }
          }
          break;
        }
        case "c": {
          // Comment: new or reply
          showCommentInput();
          break;
        }
        case "e": {
          // Expand thread at cursor
          showThreadExpandOverlay();
          break;
        }
        case "l": {
          // Thread list
          showThreadListOverlay();
          break;
        }
        case "r": {
          if (!key.shift) {
            // Resolve thread at cursor
            const thread = state.threadAtLine(state.cursorLine);
            if (thread) {
              state.resolveThread(thread.id);
              refreshPager();
            }
          } else {
            // Shift+R = resolve all pending
            state.resolveAllPending();
            refreshPager();
          }
          break;
        }
        case "d": {
          // Delete last human draft message at cursor
          const thread = state.threadAtLine(state.cursorLine);
          if (thread) {
            state.deleteLastDraftMessage(thread.id);
            refreshPager();
          }
          break;
        }
        case "a": {
          // Approve
          if (state.canApprove()) {
            writeDraftFile(draftPath, { approved: true });
            renderer.destroy();
            resolve();
            return;
          }
          break;
        }
        default: {
          // Check for "?" to toggle help
          if (key.sequence === "?") {
            showHelp = !showHelp;
            refreshPager();
            break;
          }
          // Check for "/" to enter search mode
          if (key.sequence === "/") {
            showSearchOverlay();
            break;
          }
          // Check for ":" to enter command mode
          if (key.sequence === ":") {
            commandBuffer = "";
            refreshPager();
          }
          break;
        }
      }
    });
  });
}

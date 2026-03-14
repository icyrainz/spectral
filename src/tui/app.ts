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
import { buildPagerContent, createPager, togglePagerMode, ensureLineMode, type PagerComponents } from "./pager";
import {
  buildTopBarText,
  buildBottomBarText,
  createTopBar,
  createBottomBar,
  type TopBarComponents,
  type BottomBarComponents,
} from "./status-bar";
import { createCommentInput } from "./comment-input";
// thread-expand removed — merged into comment-input
import { createSearch } from "./search";
import { createThreadList } from "./thread-list";
import { createConfirm } from "./confirm";
import { createHelp } from "./help";

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
    if (pager.mode === "line") {
      pager.lineNode.content = buildPagerContent(state, searchQuery);
    } else {
      pager.markdownNode.content = state.specLines.join("\n");
    }
    topBar.bar.content = buildTopBarText(specFile, state);
    bottomBar.bar.content = buildBottomBarText(commandBuffer, pager.mode);
    renderer.requestRender();
  }

  // Search state — remembered query for n/N cycling
  let searchQuery: string | null = null;

  // Command mode state
  let commandBuffer: string | null = null;

  // Track unsaved changes
  let hasUnsavedChanges = false;

  // Bracket-pending state for ]t / [t navigation
  let bracketPending: "]" | "[" | null = null;
  let bracketPendingTimer: ReturnType<typeof setTimeout> | null = null;

  // Delete-pending state: first `d` sets timer, second `d` within 500ms executes
  let deletePendingTimer: ReturnType<typeof setTimeout> | null = null;

  // g-pending state: first `g` sets timer, second `g` within 500ms goes to top
  let gPendingTimer: ReturnType<typeof setTimeout> | null = null;

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
    return Math.max(1, renderer.height - 2);
  }

  // Process command buffer input
  function processCommand(cmd: string, resolve: () => void): boolean {
    if (cmd === "w") {
      saveDraft();
      hasUnsavedChanges = false;
      // Show "saved" feedback briefly
      bottomBar.bar.content = " \u2714 saved";
      renderer.requestRender();
      setTimeout(() => {
        refreshPager();
      }, 1200);
      return false; // don't exit
    }
    if (cmd === "q") {
      // Block if there are unsaved changes
      if (hasUnsavedChanges) {
        bottomBar.bar.content = " \u26a0  Unsaved changes — use :wq to save and quit, or :q! to discard";
        renderer.requestRender();
        setTimeout(() => { refreshPager(); }, 2000);
        return false;
      }
      return true; // exit (already saved or no changes)
    }
    if (cmd === "wq") {
      saveDraft();
      hasUnsavedChanges = false;
      return true; // save and exit
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
        hasUnsavedChanges = true;
        dismissOverlay();
      },
      onResolve: () => {
        if (existingThread) {
          state.resolveThread(existingThread.id);
          hasUnsavedChanges = true;
        }
        dismissOverlay();
      },
      onCancel: () => {
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
      onResult: (lineNumber: number, query: string) => {
        searchQuery = query;
        state.cursorLine = lineNumber;
        dismissOverlay();
        ensureCursorVisible();
        refreshPager();
      },
      onCancel: () => {
        searchQuery = null;
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

  function showHelpOverlay(): void {
    const overlay = createHelp({
      renderer,
      onClose: () => {
        dismissOverlay();
      },
    });
    showOverlay(overlay);
  }

  // Helper: find next search match from current line in given direction, wrapping
  function findNextMatch(
    lines: string[],
    query: string,
    currentLine: number,
    direction: 1 | -1
  ): number | null {
    const q = query.toLowerCase();
    const total = lines.length;
    for (let offset = 1; offset <= total; offset++) {
      const i = ((currentLine - 1) + offset * direction + total) % total;
      if (lines[i].toLowerCase().includes(q)) {
        return i + 1; // 1-based
      }
    }
    return null;
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
          // Don't refreshPager here — processCommand handles its own bar updates
          // (e.g., :w shows "saved" briefly before refreshing via setTimeout)
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
        if (hasUnsavedChanges) {
          saveDraft();
        }
        renderer.destroy();
        resolve();
        return;
      }

      // Escape clears search highlights
      if (key.name === "escape") {
        if (searchQuery) {
          searchQuery = null;
          refreshPager();
        }
        return;
      }

      // Normal mode keybindings
      switch (key.name) {
        case "j":
        case "down": {
          if (pager.mode === "markdown") {
            pager.scrollBox.scrollBy(1);
            renderer.requestRender();
          } else {
            if (state.cursorLine < state.lineCount) {
              state.cursorLine++;
              ensureCursorVisible();
              refreshPager();
            }
          }
          break;
        }
        case "k":
        case "up": {
          if (pager.mode === "markdown") {
            pager.scrollBox.scrollBy(-1);
            renderer.requestRender();
          } else {
            if (state.cursorLine > 1) {
              state.cursorLine--;
              ensureCursorVisible();
              refreshPager();
            }
          }
          break;
        }
        case "d": {
          // Ctrl+D — half page down
          if (key.ctrl) {
            if (deletePendingTimer) { clearTimeout(deletePendingTimer); deletePendingTimer = null; }
            const half = Math.max(1, Math.floor(pageSize() / 2));
            if (pager.mode === "markdown") {
              pager.scrollBox.scrollBy(half);
              renderer.requestRender();
            } else {
              state.cursorLine = Math.min(state.cursorLine + half, state.lineCount);
              ensureCursorVisible();
              refreshPager();
            }
          } else {
            // d without ctrl — delete draft comment (dd = double-tap within 500ms)
            ensureLineMode(pager);
            refreshPager();
            const thread = state.threadAtLine(state.cursorLine);
            if (!thread) break;
            if (deletePendingTimer) {
              // Second d within 500ms — execute delete
              clearTimeout(deletePendingTimer);
              deletePendingTimer = null;
              const hadHumanMsg = thread.messages.some((m) => m.author === "human");
              if (hadHumanMsg) {
                state.deleteLastDraftMessage(thread.id);
                hasUnsavedChanges = true;
                refreshPager();
                bottomBar.bar.content = " \u2714 Deleted draft comment";
                renderer.requestRender();
                setTimeout(() => { refreshPager(); }, 1500);
              } else {
                bottomBar.bar.content = " No human message to delete";
                renderer.requestRender();
                setTimeout(() => { refreshPager(); }, 1500);
              }
            } else {
              // First d — show hint and start timer
              bottomBar.bar.content = " Press d again to delete";
              renderer.requestRender();
              deletePendingTimer = setTimeout(() => {
                deletePendingTimer = null;
                refreshPager();
              }, 500);
            }
          }
          break;
        }
        case "u": {
          // Ctrl+U — half page up
          if (key.ctrl) {
            const half = Math.max(1, Math.floor(pageSize() / 2));
            if (pager.mode === "markdown") {
              pager.scrollBox.scrollBy(-half);
              renderer.requestRender();
            } else {
              state.cursorLine = Math.max(state.cursorLine - half, 1);
              ensureCursorVisible();
              refreshPager();
            }
          }
          break;
        }
        case "n": {
          if (!key.shift) {
            if (searchQuery) {
              const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, 1);
              if (match !== null) {
                state.cursorLine = match;
                ensureCursorVisible();
              }
            } else {
              bottomBar.bar.content = " No active search \u2014 use / to search";
              renderer.requestRender();
              setTimeout(() => { refreshPager(); }, 1500);
            }
          } else {
            // Shift+N = prev search match
            if (searchQuery) {
              const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, -1);
              if (match !== null) {
                state.cursorLine = match;
                ensureCursorVisible();
              }
            } else {
              bottomBar.bar.content = " No active search \u2014 use / to search";
              renderer.requestRender();
              setTimeout(() => { refreshPager(); }, 1500);
            }
          }
          refreshPager();
          break;
        }
        case "m": {
          // Toggle markdown / line mode with scroll position sync
          const wasMarkdown = pager.mode === "markdown";
          togglePagerMode(pager);
          if (wasMarkdown) {
            // Markdown → Line: sync scroll position to cursor
            state.cursorLine = Math.max(1, pager.scrollBox.scrollTop + 1);
            refreshPager();
            ensureCursorVisible();
          } else {
            // Line → Markdown: approximate scroll to cursor position
            refreshPager();
            pager.scrollBox.scrollTo(state.cursorLine - 1);
            renderer.requestRender();
          }
          break;
        }
        case "c": {
          // Comment: new or reply — auto-switch to line mode
          ensureLineMode(pager);
          refreshPager();
          showCommentInput();
          break;
        }
        case "l": {
          // Thread list
          ensureLineMode(pager);
          refreshPager();
          showThreadListOverlay();
          break;
        }
        case "r": {
          ensureLineMode(pager);
          refreshPager();
          if (!key.shift) {
            // Resolve thread at cursor
            const thread = state.threadAtLine(state.cursorLine);
            if (thread) {
              const wasResolved = thread.status === "resolved";
              state.resolveThread(thread.id);
              hasUnsavedChanges = true;
              refreshPager();
              const msg = wasResolved
                ? ` \u21a9 Reopened thread #${thread.id}`
                : ` \u2714 Resolved thread #${thread.id}`;
              bottomBar.bar.content = msg;
              renderer.requestRender();
              setTimeout(() => { refreshPager(); }, 1500);
            }
          } else {
            // Shift+R = resolve all pending
            const { pending } = state.activeThreadCount();
            state.resolveAllPending();
            hasUnsavedChanges = true;
            refreshPager();
            bottomBar.bar.content = ` \u2714 Resolved ${pending} pending thread(s)`;
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          }
          break;
        }
        case "g": {
          if (key.shift) {
            // G (shift+g) — go to last line / scroll to bottom
            if (pager.mode === "markdown") {
              pager.scrollBox.scrollTo(pager.scrollBox.scrollHeight);
              renderer.requestRender();
            } else {
              state.cursorLine = state.lineCount;
              ensureCursorVisible();
              refreshPager();
            }
          } else {
            // g — first of gg sequence
            if (gPendingTimer) {
              // Second g within 500ms — go to first line / scroll to top
              clearTimeout(gPendingTimer);
              gPendingTimer = null;
              if (pager.mode === "markdown") {
                pager.scrollBox.scrollTo(0);
                renderer.requestRender();
              } else {
                state.cursorLine = 1;
                ensureCursorVisible();
                refreshPager();
              }
            } else {
              gPendingTimer = setTimeout(() => {
                gPendingTimer = null;
              }, 500);
            }
          }
          break;
        }
        case "a": {
          // Approve
          ensureLineMode(pager);
          refreshPager();
          if (state.canApprove()) {
            const confirmOverlay = createConfirm({
              renderer,
              message: "Approve spec and proceed to implementation? [y/n]",
              onConfirm: () => {
                dismissOverlay();
                writeDraftFile(draftPath, { approved: true });
                renderer.destroy();
                resolve();
              },
              onCancel: () => {
                dismissOverlay();
              },
            });
            showOverlay(confirmOverlay);
            return;
          } else {
            // Show why approval is blocked
            const { open, pending } = state.activeThreadCount();
            const total = open + pending;
            const msg =
              total === 0
                ? "No threads to approve"
                : `${total} thread${total !== 1 ? "s" : ""} still open/pending`;
            bottomBar.bar.content = ` \u26a0  ${msg}`;
            renderer.requestRender();
            setTimeout(() => {
              refreshPager();
            }, 2000);
          }
          break;
        }
        default: {
          // Handle bracket-pending sequences (]t / [t)
          if (bracketPending !== null) {
            const pending = bracketPending;
            bracketPending = null;
            if (bracketPendingTimer) { clearTimeout(bracketPendingTimer); bracketPendingTimer = null; }
            if (key.name === "t" || key.sequence === "t") {
              if (pending === "]") {
                const next = state.nextActiveThread();
                if (next !== null) {
                  state.cursorLine = next;
                  ensureCursorVisible();
                  refreshPager();
                }
              } else {
                const prev = state.prevActiveThread();
                if (prev !== null) {
                  state.cursorLine = prev;
                  ensureCursorVisible();
                  refreshPager();
                }
              }
            }
            refreshPager(); // clear the bracket hint
            break;
          }
          // Check for "]" or "[" to start bracket sequence
          if (key.sequence === "]") {
            bracketPending = "]";
            bottomBar.bar.content = " ]...";
            renderer.requestRender();
            bracketPendingTimer = setTimeout(() => {
              bracketPending = null;
              bracketPendingTimer = null;
              refreshPager();
            }, 500);
            break;
          }
          if (key.sequence === "[") {
            bracketPending = "[";
            bottomBar.bar.content = " [...";
            renderer.requestRender();
            bracketPendingTimer = setTimeout(() => {
              bracketPending = null;
              bracketPendingTimer = null;
              refreshPager();
            }, 500);
            break;
          }
          // Check for "?" to show help overlay
          if (key.sequence === "?") {
            showHelpOverlay();
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

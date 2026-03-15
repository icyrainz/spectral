import { readFileSync, statSync, existsSync } from "fs";
import { dirname, basename } from "path";
import {
  createCliRenderer,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { readReviewFile } from "../protocol/read";
import { writeReviewFile } from "../protocol/write";
import { appendEvent, readEventsFromOffset, replayEventsToThreads } from "../protocol/live-events";
import { mergeJsonlIntoReview } from "../protocol/live-merge";
import type { Thread } from "../protocol/types";
import { ReviewState } from "../state/review-state";
import { createLiveWatcher, type LiveWatcher } from "./live-watcher";
import { buildPagerNodes, createPager, countExtraVisualLines, type PagerComponents } from "./pager";
import {
  buildTopBar,
  buildBottomBar,
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
import { createKeybindRegistry, type KeyBinding } from "./ui/keybinds";

export async function runTui(
  specFile: string,
  reviewPath: string,
  draftPath: string,
  version?: string
): Promise<void> {
  // 1. Read spec file into lines
  const specContent = readFileSync(specFile, "utf8");
  const specLines = specContent.split("\n");

  // 2. Load existing review, merge threads
  const existingReview = readReviewFile(reviewPath);

  let threads: Thread[] = [];
  if (existingReview) {
    threads = existingReview.threads.map((t) => ({
      ...t,
      messages: [...t.messages],
    }));
  }

  // 3. Create ReviewState
  const state = new ReviewState(specLines, threads);

  // 4. Derive JSONL path and set up live protocol
  const dir = dirname(specFile);
  const base = basename(specFile, ".md");
  const jsonlPath = `${dir}/${base}.review.live.jsonl`;
  const reviewPathForMerge = `${dir}/${base}.review.json`;

  // Crash recovery: replay JSONL events if file exists
  if (existsSync(jsonlPath)) {
    const { events } = readEventsFromOffset(jsonlPath, 0);
    const replayedThreads = replayEventsToThreads(events);
    for (const rt of replayedThreads) {
      const existing = state.threads.find(t => t.id === rt.id);
      if (!existing) {
        state.threads.push(rt);
      } else {
        existing.messages = rt.messages;
        existing.status = rt.status;
      }
    }
  }

  // Create and start the live watcher
  const liveWatcher: LiveWatcher = createLiveWatcher(jsonlPath, (ownerEvents) => {
    for (const event of ownerEvents) {
      if (event.type === "reply" && event.threadId && event.text) {
        state.addOwnerReply(event.threadId, event.text, event.ts);
        // If the thread popup is open for this thread, push the message in
        if (activeOverlay?.addMessage && activeOverlay?.threadId === event.threadId) {
          activeOverlay.addMessage({ author: "owner", text: event.text, ts: event.ts });
        }
      }
    }
    refreshPager();
  });
  liveWatcher.start();

  // Record spec mtime for mutation guard
  let specMtime = statSync(specFile).mtimeMs;
  let specMtimeChanged = false;

  // 5. Create renderer
  const renderer = await createCliRenderer({
    useAlternateScreen: true,
    exitOnCtrlC: false,
    useMouse: false,
  });

  // 6. Build layout (opencode pattern): flex column, scrollbox fills middle
  const rootBox = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    width: "100%",
  });

  const topBar: TopBarComponents = createTopBar(renderer);
  const pager: PagerComponents = createPager(renderer);
  const bottomBar: BottomBarComponents = createBottomBar(renderer);

  rootBox.add(topBar.box);
  rootBox.add(pager.scrollBox);
  rootBox.add(bottomBar.box);
  renderer.root.add(rootBox);

  // 7. Initial render
  function refreshPager(): void {
    // Spec mutation guard
    try {
      const currentMtime = statSync(specFile).mtimeMs;
      if (currentMtime !== specMtime) {
        specMtimeChanged = true;
      }
    } catch {}

    buildPagerNodes(pager.lineNode, state, searchQuery, state.unreadThreadIds);
    buildTopBar(topBar, specFile, state, state.unreadCount(), specMtimeChanged);
    buildBottomBar(bottomBar, commandBuffer);
    renderer.requestRender();
  }

  // Search state — remembered query for n/N cycling
  let searchQuery: string | null = null;

  // Command mode state
  let commandBuffer: string | null = null;

  // Overlay state — when an overlay is active, normal keybindings are blocked.
  // The overlay's own key handlers manage its lifecycle.
  type ActiveOverlay = {
    container: BoxRenderable;
    cleanup: () => void;
    addMessage?: (msg: import("../protocol/types").Message) => void;
    threadId?: string | null;
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

  // Helper: merge JSONL into review JSON and clean up
  // Track whether we have unmerged changes since last :w
  let lastMergedOffset = 0;

  function hasPendingChanges(): boolean {
    if (!existsSync(jsonlPath)) return false;
    const { size } = statSync(jsonlPath);
    return size > lastMergedOffset;
  }

  function doMerge(): void {
    const existingReviewForMerge = readReviewFile(reviewPathForMerge);
    const merged = mergeJsonlIntoReview(jsonlPath, existingReviewForMerge, specFile);
    writeReviewFile(reviewPathForMerge, merged);
    if (existsSync(jsonlPath)) {
      lastMergedOffset = statSync(jsonlPath).size;
    }
  }

  function mergeAndExit(resolve: () => void): void {
    doMerge();
    // Signal to watch process that session has ended
    appendEvent(jsonlPath, { type: "session-end", author: "reviewer", ts: Date.now() });
    liveWatcher.stop();
    keybinds.destroy();
    renderer.destroy();
    resolve();
  }

  // Helper: scroll pager to ensure cursor line is visible
  function ensureCursorVisible(): void {
    // Map spec line to visual row, accounting for table border extra lines
    const extra = countExtraVisualLines(state.specLines, state.cursorLine - 1);
    const cursorRow = state.cursorLine - 1 + extra;
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
  // Returns: "exit" to exit (caller should destroy+resolve), "merged" if already handled, "stay" to keep running
  function processCommand(cmd: string, resolve: () => void): "exit" | "merged" | "stay" {
    if (cmd === "w") {
      // Merge JSONL -> JSON, stay open
      doMerge();
      bottomBar.text.content = " \u2714 Merged to review JSON";
      renderer.requestRender();
      setTimeout(() => { refreshPager(); }, 1200);
      return "stay";
    }
    if (cmd === "wq") {
      // Merge and exit
      mergeAndExit(resolve);
      return "merged";
    }
    if (cmd === "q") {
      // Exit only if merged (no pending changes)
      if (hasPendingChanges()) {
        bottomBar.text.content = " Unmerged changes. Use :w to save or :q! to discard";
        renderer.requestRender();
        setTimeout(() => { refreshPager(); }, 2000);
        return "stay";
      }
      appendEvent(jsonlPath, { type: "session-end", author: "reviewer", ts: Date.now() });
      liveWatcher.stop();
      keybinds.destroy();
      return "exit";
    }
    if (cmd === "q!") {
      // Exit without merging
      appendEvent(jsonlPath, { type: "session-end", author: "reviewer", ts: Date.now() });
      liveWatcher.stop();
      keybinds.destroy();
      return "exit";
    }
    return "stay"; // unknown command, ignore
  }

  // --- Overlay launchers ---

  function showCommentInput(): void {
    let existingThread = state.threadAtLine(state.cursorLine);

    const overlay = createCommentInput({
      renderer,
      line: state.cursorLine,
      existingThread,
      onSubmit: (text: string) => {
        if (existingThread) {
          // Reply to existing thread — stay open
          state.replyToThread(existingThread.id, text);
          state.markRead(existingThread.id);
          appendEvent(jsonlPath, { type: "reply", threadId: existingThread.id, author: "reviewer", text, ts: Date.now() });
          refreshPager();
          // Don't dismiss — overlay stays open, message appended by comment-input
        } else {
          // New comment — create thread, stay open
          state.addComment(state.cursorLine, text);
          const newThread = state.threadAtLine(state.cursorLine);
          if (newThread) {
            appendEvent(jsonlPath, { type: "comment", threadId: newThread.id, line: state.cursorLine, author: "reviewer", text, ts: Date.now() });
            // Update overlay to reference the new thread
            if (activeOverlay) {
              activeOverlay.threadId = newThread.id;
              activeOverlay.container.title = ` Thread #${newThread.id} (line ${state.cursorLine}) `;
            }
            existingThread = newThread;
          }
          refreshPager();
        }
      },
      onResolve: () => {
        if (existingThread) {
          const wasResolved = existingThread.status === "resolved";
          state.resolveThread(existingThread.id);
          state.markRead(existingThread.id);
          appendEvent(jsonlPath, { type: wasResolved ? "unresolve" : "resolve", threadId: existingThread.id, author: "reviewer", ts: Date.now() });
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
      version: version ?? "?",
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

  // --- Keybind registry ---

  const bindings: KeyBinding[] = [
    { key: "j", action: "cursor-down" },
    { key: "down", action: "cursor-down" },
    { key: "k", action: "cursor-up" },
    { key: "up", action: "cursor-up" },
    { key: "C-d", action: "half-page-down" },
    { key: "C-u", action: "half-page-up" },
    { key: "G", action: "goto-bottom" },
    { key: "gg", action: "goto-top" },
    { key: "n", action: "search-next" },
    { key: "N", action: "search-prev" },
    { key: "c", action: "comment" },
    { key: "l", action: "thread-list" },
    { key: "r", action: "resolve" },
    { key: "R", action: "resolve-all" },
    { key: "dd", action: "delete-draft" },
    { key: "a", action: "approve" },
    { key: "]t", action: "next-thread" },
    { key: "[t", action: "prev-thread" },
    { key: "]r", action: "next-unread" },
    { key: "[r", action: "prev-unread" },
    { key: "?", action: "help" },
    { key: "/", action: "search" },
    { key: ":", action: "command-mode" },
  ];
  const keybinds = createKeybindRegistry(bindings);

  refreshPager();
  renderer.start();

  // 8. Set up keybinding handler
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
          const result = processCommand(cmd, resolve);
          if (result === "exit") {
            renderer.destroy();
            resolve();
            return;
          }
          if (result === "merged") {
            // mergeAndExit already called destroy+resolve
            return;
          }
          // "stay" — don't refreshPager here, processCommand handles its own bar updates
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

      // Ctrl+C to exit — merge and quit
      if (key.ctrl && key.name === "c") {
        mergeAndExit(resolve);
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
      const action = keybinds.match(key);

      // Show pending sequence hint
      if (!action) {
        const p = keybinds.pending();
        if (p) {
          bottomBar.text.content = ` ${p}`;
          renderer.requestRender();
        }
        return;
      }

      switch (action) {
        case "cursor-down":
          if (state.cursorLine < state.lineCount) {
            state.cursorLine++;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        case "cursor-up":
          if (state.cursorLine > 1) {
            state.cursorLine--;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        case "half-page-down": {
          const half = Math.max(1, Math.floor(pageSize() / 2));
          state.cursorLine = Math.min(state.cursorLine + half, state.lineCount);
          ensureCursorVisible();
          refreshPager();
          break;
        }
        case "half-page-up": {
          const half = Math.max(1, Math.floor(pageSize() / 2));
          state.cursorLine = Math.max(state.cursorLine - half, 1);
          ensureCursorVisible();
          refreshPager();
          break;
        }
        case "goto-bottom":
          state.cursorLine = state.lineCount;
          ensureCursorVisible();
          refreshPager();
          break;
        case "goto-top":
          state.cursorLine = 1;
          ensureCursorVisible();
          refreshPager();
          break;
        case "search-next":
          if (searchQuery) {
            const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, 1);
            if (match !== null) {
              state.cursorLine = match;
              ensureCursorVisible();
            }
          } else {
            bottomBar.text.content = " No active search \u2014 use / to search";
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          }
          refreshPager();
          break;
        case "search-prev":
          if (searchQuery) {
            const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, -1);
            if (match !== null) {
              state.cursorLine = match;
              ensureCursorVisible();
            }
          } else {
            bottomBar.text.content = " No active search \u2014 use / to search";
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          }
          refreshPager();
          break;
        case "comment":
          showCommentInput();
          break;
        case "thread-list":
          showThreadListOverlay();
          break;
        case "resolve": {
          const thread = state.threadAtLine(state.cursorLine);
          if (thread) {
            const wasResolved = thread.status === "resolved";
            state.resolveThread(thread.id);
            state.markRead(thread.id);
            appendEvent(jsonlPath, { type: wasResolved ? "unresolve" : "resolve", threadId: thread.id, author: "reviewer", ts: Date.now() });
            refreshPager();
            const msg = wasResolved
              ? ` \u21a9 Reopened thread #${thread.id}`
              : ` \u2714 Resolved thread #${thread.id}`;
            bottomBar.text.content = msg;
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          }
          break;
        }
        case "resolve-all": {
          const { pending } = state.activeThreadCount();
          const pendingThreads = state.threads.filter(t => t.status === "pending");
          state.resolveAllPending();
          for (const t of pendingThreads) {
            appendEvent(jsonlPath, { type: "resolve", threadId: t.id, author: "reviewer", ts: Date.now() });
          }
          refreshPager();
          bottomBar.text.content = ` \u2714 Resolved ${pending} pending thread(s)`;
          renderer.requestRender();
          setTimeout(() => { refreshPager(); }, 1500);
          break;
        }
        case "delete-draft": {
          const thread = state.threadAtLine(state.cursorLine);
          if (!thread) break;
          const hadReviewerMsg = thread.messages.some((m) => m.author === "reviewer");
          if (hadReviewerMsg) {
            state.deleteLastDraftMessage(thread.id);
            appendEvent(jsonlPath, { type: "delete", threadId: thread.id, author: "reviewer", ts: Date.now() });
            refreshPager();
            bottomBar.text.content = " \u2714 Deleted draft comment";
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          } else {
            bottomBar.text.content = " No reviewer message to delete";
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 1500);
          }
          break;
        }
        case "approve":
          if (state.canApprove()) {
            const confirmOverlay = createConfirm({
              renderer,
              message: "Approve spec and proceed to implementation? [y/n]",
              onConfirm: () => {
                dismissOverlay();
                appendEvent(jsonlPath, { type: "approve", author: "reviewer", ts: Date.now() });
                mergeAndExit(resolve);
              },
              onCancel: () => {
                dismissOverlay();
              },
            });
            showOverlay(confirmOverlay);
          } else {
            const { open, pending } = state.activeThreadCount();
            const total = open + pending;
            const msg = total === 0
              ? "No threads to approve"
              : `${total} thread${total !== 1 ? "s" : ""} still open/pending`;
            bottomBar.text.content = ` \u26a0  ${msg}`;
            renderer.requestRender();
            setTimeout(() => { refreshPager(); }, 2000);
          }
          break;
        case "next-thread": {
          const next = state.nextActiveThread();
          if (next !== null) {
            state.cursorLine = next;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "prev-thread": {
          const prev = state.prevActiveThread();
          if (prev !== null) {
            state.cursorLine = prev;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "next-unread": {
          const nextLine = state.nextUnreadThread();
          if (nextLine !== null) {
            state.cursorLine = nextLine;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "prev-unread": {
          const prevLine = state.prevUnreadThread();
          if (prevLine !== null) {
            state.cursorLine = prevLine;
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "help":
          showHelpOverlay();
          break;
        case "search":
          showSearchOverlay();
          break;
        case "command-mode":
          commandBuffer = "";
          refreshPager();
          break;
      }
    });
  });
}

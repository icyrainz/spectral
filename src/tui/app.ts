import { readFileSync, statSync, existsSync } from "fs";
import { dirname, basename } from "path";
import {
  createCliRenderer,
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { appendEvent, readEventsFromOffset, replayEventsToThreads } from "../protocol/live-events";
import type { Thread } from "../protocol/types";
import { ReviewState } from "../state/review-state";
import { createLiveWatcher, type LiveWatcher } from "./live-watcher";
import { buildPagerNodes, createPager, countExtraVisualLines, type PagerComponents } from "./pager";
import {
  buildTopBar,
  buildBottomBar,
  setBottomBarMessage,
  createTopBar,
  createBottomBar,
  type TopBarComponents,
  type BottomBarComponents,
} from "./status-bar";
import { createCommentInput } from "./comment-input";
import { createSearch } from "./search";
import { createThreadList } from "./thread-list";
import { createConfirm } from "./confirm";
import { createHelp } from "./help";
import { createSpinner } from "./spinner";
import { createKeybindRegistry, type KeyBinding } from "./ui/keybinds";
import { theme } from "./ui/theme";

export async function runTui(
  specFile: string,
  version?: string
): Promise<void> {
  // 1. Read spec file into lines
  const specContent = readFileSync(specFile, "utf8");
  const specLines = specContent.split("\n");

  // 2. Create ReviewState
  const state = new ReviewState(specLines, []);

  // 4. Derive JSONL path and set up live protocol
  const dir = dirname(specFile);
  const base = basename(specFile, ".md");
  const jsonlPath = `${dir}/${base}.review.jsonl`;
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
    let lastReplyThread: { id: string; line: number } | null = null;
    for (const event of ownerEvents) {
      if (event.type === "reply" && event.threadId && event.text) {
        state.addOwnerReply(event.threadId, event.text, event.ts);
        const thread = state.threads.find((t) => t.id === event.threadId);
        if (thread) lastReplyThread = { id: thread.id, line: thread.line };
        // If the thread popup is open for this thread, push the message in
        if (activeOverlay?.addMessage && activeOverlay?.threadId === event.threadId) {
          activeOverlay.addMessage({ author: "owner", text: event.text, ts: event.ts });
        }
      }
    }
    refreshPager();
    // Flash notification for AI replies when not viewing that thread
    if (lastReplyThread && activeOverlay?.threadId !== lastReplyThread.id) {
      showTransient(`AI replied on line ${lastReplyThread.line}`, "info");
    }
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

  // Wrap mode state
  let wrapEnabled = false;
  function currentWrapWidth(): number {
    return wrapEnabled ? renderer.width : 0;
  }

  // 7. Initial render
  function refreshPager(): void {
    // Spec mutation guard
    try {
      const currentMtime = statSync(specFile).mtimeMs;
      if (currentMtime !== specMtime) {
        specMtimeChanged = true;
      }
    } catch {}

    buildPagerNodes(pager.lineNode, state, searchQuery, state.unreadThreadIds, currentWrapWidth());
    buildTopBar(topBar, specFile, state, state.unreadCount(), specMtimeChanged);
    // Don't overwrite transient messages (welcome hint, warnings) during navigation
    if (!messageTimer) {
      const curThread = state.threadAtLine(state.cursorLine);
      if (curThread && curThread.messages.length > 0 && commandBuffer === null) {
        // Show thread preview in bottom bar
        const first = curThread.messages[0].text.replace(/\n/g, " ");
        const replies = curThread.messages.length - 1;
        const preview = first.length > 60 ? first.slice(0, 59) + "\u2026" : first;
        const replyStr = replies > 0 ? ` (${replies} repl${replies === 1 ? "y" : "ies"})` : "";
        setBottomBarMessage(bottomBar, `${preview}${replyStr} [${curThread.status}]`);
      } else {
        buildBottomBar(bottomBar, commandBuffer, !!curThread);
      }
    }
    renderer.requestRender();
  }

  // Search state — remembered query for n/N cycling
  let searchQuery: string | null = null;

  // Command mode state
  let commandBuffer: string | null = null;

  // Transient message timer — prevents stale timeouts from clobbering each other
  let messageTimer: ReturnType<typeof setTimeout> | null = null;
  function showTransient(message: string, icon?: import("./status-bar").MessageIcon, ms = 1500): void {
    if (messageTimer) clearTimeout(messageTimer);
    setBottomBarMessage(bottomBar, message, icon);
    renderer.requestRender();
    messageTimer = setTimeout(() => { messageTimer = null; refreshPager(); }, ms);
  }

  // Jump list — mirrors vim's :jumps behavior.
  // pushJump() is called BEFORE each big jump to record the departure position.
  // Ctrl+O traverses backward, Ctrl+I forward. Making a new jump while in the
  // middle of the list discards forward history (same as vim).
  const jumpList: number[] = [1];
  let jumpIndex: number = 0;
  const MAX_JUMP_LIST = 50;

  function pushJump(): void {
    const cur = state.cursorLine;
    // Discard forward history when making a new jump from the middle
    if (jumpIndex < jumpList.length - 1) {
      jumpList.splice(jumpIndex + 1);
    }
    // Don't push duplicate of the list tail
    if (jumpList.length > 0 && jumpList[jumpList.length - 1] === cur) return;
    jumpList.push(cur);
    if (jumpList.length > MAX_JUMP_LIST) jumpList.shift();
    jumpIndex = jumpList.length - 1;
  }

  function savePrevPosition(): void {
    pushJump();
  }

  // Map visual row back to spec line number (for H/M/L)
  function visualRowToSpecLine(targetRow: number): number {
    for (let i = 0; i < state.specLines.length; i++) {
      const row = i + countExtraVisualLines(state.specLines, i, currentWrapWidth());
      if (row >= targetRow) return i + 1;
    }
    return state.lineCount;
  }

  // Active spec poll interval (for submit spinner leak prevention)
  let activeSpecPoll: ReturnType<typeof setInterval> | null = null;

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

  // Helper: exit the TUI cleanly
  function exitTui(resolve: () => void, eventType: "session-end" | "approve"): void {
    appendEvent(jsonlPath, { type: eventType, author: "reviewer", ts: Date.now() });
    liveWatcher.stop();
    keybinds.destroy();
    renderer.destroy();
    resolve();
  }

  // Helper: scroll pager to ensure cursor line is visible
  function ensureCursorVisible(): void {
    // Map spec line to visual row, accounting for table border extra lines
    const extra = countExtraVisualLines(state.specLines, state.cursorLine - 1, currentWrapWidth());
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
  function processCommand(cmd: string, resolve: () => void): "exit" | "stay" {
    const forceQuit = ["q!", "qa!", "wq!", "wqa!", "qw!", "qwa!"];
    const safeQuit = ["q", "qa", "wq", "wqa", "qw", "qwa"];
    if (forceQuit.includes(cmd)) {
      exitTui(resolve, "session-end");
      return "exit";
    }
    if (safeQuit.includes(cmd)) {
      const { open, pending } = state.activeThreadCount();
      const total = open + pending;
      if (total > 0) {
        showTransient(`${total} unresolved thread(s). Use :q! to force quit`, "warn", 2000);
        return "stay";
      }
      exitTui(resolve, "session-end");
      return "exit";
    }
    // :wrap — toggle line wrapping
    if (cmd === "wrap") {
      wrapEnabled = !wrapEnabled;
      refreshPager();
      showTransient(wrapEnabled ? "Line wrap on" : "Line wrap off", "info");
      return "stay";
    }
    // :{N} — jump to line number
    const lineNum = parseInt(cmd, 10);
    if (!isNaN(lineNum) && lineNum > 0) {
      savePrevPosition();
      state.cursorLine = Math.min(lineNum, state.lineCount);
      ensureCursorVisible();
      refreshPager();
      return "stay";
    }
    showTransient(`Unknown command: ${cmd}`, "warn");
    return "stay";
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
        let didResolve = false;
        if (existingThread) {
          const wasResolved = existingThread.status === "resolved";
          didResolve = !wasResolved;
          state.resolveThread(existingThread.id);
          state.markRead(existingThread.id);
          appendEvent(jsonlPath, { type: wasResolved ? "unresolve" : "resolve", threadId: existingThread.id, author: "reviewer", ts: Date.now() });
        }
        dismissOverlay();
        // Auto-advance to next thread only when resolving (not reopening)
        if (didResolve) {
          const nextLine = state.nextThread();
          if (nextLine !== null) {
            state.cursorLine = nextLine;
            ensureCursorVisible();
          }
        }
        refreshPager();
      },
      onCancel: () => {
        if (existingThread) state.markRead(existingThread.id);
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
        savePrevPosition();
        state.cursorLine = lineNumber;
        ensureCursorVisible();
        dismissOverlay(); // calls refreshPager with cursor + scroll already set
      },
      onPreview: (query: string | null) => {
        searchQuery = query;
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
        savePrevPosition();
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

  // Helper: gate that checks for unresolved threads.
  // If unresolved, shows confirm popup to resolve all.
  // Calls onProceed() when all threads are resolved.
  function unresolvedGate(onProceed: () => void): void {
    if (state.canApprove()) {
      onProceed();
      return;
    }
    const { open, pending } = state.activeThreadCount();
    const total = open + pending;
    const confirmOverlay = createConfirm({
      renderer,
      title: "Unresolved Threads",
      message: `${total} thread(s) still unresolved. Resolve all and continue?`,
      onConfirm: () => {
        dismissOverlay();
        const unresolved = state.threads.filter(
          t => t.status !== "resolved" && t.status !== "outdated"
        );
        state.resolveAll();
        for (const t of unresolved) {
          appendEvent(jsonlPath, { type: "resolve", threadId: t.id, author: "reviewer", ts: Date.now() });
        }
        refreshPager();
        onProceed();
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(confirmOverlay);
  }

  // Helper: find next search match from current line in given direction, wrapping
  function findNextMatch(
    lines: string[],
    query: string,
    currentLine: number,
    direction: 1 | -1
  ): number | null {
    // Smartcase: if query has any uppercase, case-sensitive
    const caseSensitive = query !== query.toLowerCase();
    const q = caseSensitive ? query : query.toLowerCase();
    const total = lines.length;
    for (let offset = 1; offset <= total; offset++) {
      const i = ((currentLine - 1) + offset * direction + total) % total;
      const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (line.includes(q)) {
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
    { key: "t", action: "thread-list" },
    { key: "r", action: "resolve" },
    { key: "R", action: "resolve-all" },
    { key: "dd", action: "delete-draft" },
    { key: "S", action: "submit" },
    { key: "A", action: "approve" },
    { key: "]t", action: "next-thread" },
    { key: "[t", action: "prev-thread" },
    { key: "]r", action: "next-unread" },
    { key: "[r", action: "prev-unread" },
    { key: "]1", action: "next-h1" },
    { key: "[1", action: "prev-h1" },
    { key: "]2", action: "next-h2" },
    { key: "[2", action: "prev-h2" },
    { key: "]3", action: "next-h3" },
    { key: "[3", action: "prev-h3" },
    { key: "''", action: "jump-back" },
    { key: "H", action: "screen-top" },
    { key: "M", action: "screen-middle" },
    { key: "L", action: "screen-bottom" },
    { key: "zz", action: "center-cursor" },
    { key: "?", action: "help" },
    { key: "/", action: "search" },
    { key: ":", action: "command-mode" },
  ];
  const keybinds = createKeybindRegistry(bindings, 300);

  refreshPager();
  if (state.threads.length === 0) {
    showTransient("Navigate to a line and press c to comment  |  ? for help", "info", 8000);
  }
  renderer.start();

  // 8. Set up keybinding handler
  return new Promise<void>((resolve) => {
    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      // If an overlay is active, only handle Ctrl+C to force dismiss.
      // All other keys pass through to the overlay's own handlers
      // (e.g., TextareaRenderable for typing in comment input).
      if (activeOverlay) {
        if (key.ctrl && key.name === "c") {
          if (activeSpecPoll) {
            clearInterval(activeSpecPoll);
            activeSpecPoll = null;
          }
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
            // exitTui already called destroy+resolve
            return;
          }
          // "stay" — processCommand handles its own bar updates
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
        exitTui(resolve, "session-end");
        return;
      }

      // Ctrl+O: jump back in jump list
      if (key.ctrl && key.name === "o") {
        // Starting backward traversal from head — save current position first
        // (without splicing forward history, unlike pushJump)
        if (jumpIndex === jumpList.length - 1) {
          const cur = state.cursorLine;
          if (jumpList[jumpIndex] !== cur) {
            jumpList.push(cur);
            if (jumpList.length > MAX_JUMP_LIST) jumpList.shift();
            jumpIndex = jumpList.length - 1;
          }
        }
        if (jumpIndex > 0) {
          jumpIndex--;
          state.cursorLine = Math.min(jumpList[jumpIndex], state.lineCount);
          ensureCursorVisible();
          refreshPager();
        }
        return;
      }

      // Ctrl+I / Tab: jump forward in jump list
      if ((key.ctrl && key.name === "i") || key.name === "tab") {
        if (jumpIndex < jumpList.length - 1) {
          jumpIndex++;
          state.cursorLine = Math.min(jumpList[jumpIndex], state.lineCount);
          ensureCursorVisible();
          refreshPager();
        }
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
          setBottomBarMessage(bottomBar, ` ${p}`);
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
          savePrevPosition();
          state.cursorLine = state.lineCount;
          ensureCursorVisible();
          refreshPager();
          break;
        case "goto-top":
          savePrevPosition();
          state.cursorLine = 1;
          ensureCursorVisible();
          refreshPager();
          break;
        case "center-cursor": {
          const extra = countExtraVisualLines(state.specLines, state.cursorLine - 1, currentWrapWidth());
          const cursorRow = state.cursorLine - 1 + extra;
          const halfView = Math.floor(pageSize() / 2);
          pager.scrollBox.scrollTo(Math.max(0, cursorRow - halfView));
          refreshPager();
          break;
        }
        case "search-next":
          if (searchQuery) {
            const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, 1);
            if (match !== null) {
              const wrapped = match <= state.cursorLine;
              savePrevPosition();
              state.cursorLine = match;
              ensureCursorVisible();
              refreshPager();
              if (wrapped) {
                showTransient("Search wrapped to top", "info", 1200);
              }
            } else {
              refreshPager();
            }
          } else {
            showTransient("No active search \u2014 use / to search");
          }
          break;
        case "search-prev":
          if (searchQuery) {
            const match = findNextMatch(state.specLines, searchQuery, state.cursorLine, -1);
            if (match !== null) {
              const wrapped = match >= state.cursorLine;
              savePrevPosition();
              state.cursorLine = match;
              ensureCursorVisible();
              refreshPager();
              if (wrapped) {
                showTransient("Search wrapped to bottom", "info", 1200);
              }
            } else {
              refreshPager();
            }
          } else {
            showTransient("No active search \u2014 use / to search");
          }
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
            showTransient(
              wasResolved ? `Reopened thread #${thread.id}` : `Resolved thread #${thread.id}`,
              "success");
          } else {
            showTransient("No thread on this line");
          }
          break;
        }
        case "resolve-all": {
          const { pending } = state.activeThreadCount();
          if (pending === 0) {
            showTransient("No pending threads");
            break;
          }
          const pendingThreads = state.threads.filter(t => t.status === "pending");
          state.resolveAllPending();
          for (const t of pendingThreads) {
            appendEvent(jsonlPath, { type: "resolve", threadId: t.id, author: "reviewer", ts: Date.now() });
          }
          refreshPager();
          showTransient(`Resolved ${pending} pending thread(s)`, "success");
          break;
        }
        case "delete-draft": {
          const thread = state.threadAtLine(state.cursorLine);
          if (!thread) {
            showTransient("No thread on this line");
            break;
          }
          const deleteOverlay = createConfirm({
            renderer,
            title: "Delete Thread",
            message: `Delete thread #${thread.id} on line ${thread.line}?`,
            onConfirm: () => {
              dismissOverlay();
              state.deleteThread(thread.id);
              appendEvent(jsonlPath, { type: "delete", threadId: thread.id, author: "reviewer", ts: Date.now() });
              refreshPager();
              showTransient(`Deleted thread #${thread.id}`, "success");
            },
            onCancel: () => {
              dismissOverlay();
            },
          });
          showOverlay(deleteOverlay);
          break;
        }
        case "submit":
          if (state.threads.length === 0) {
            setBottomBarMessage(bottomBar, "No threads to submit.");
            renderer.requestRender();
            break;
          }
          unresolvedGate(() => {
            appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: Date.now() });

            const count = state.threads.length;
            const spinnerOverlay = createSpinner({
              renderer,
              message: `Submitting ${count} thread${count === 1 ? "" : "s"}...`,
              onCancel: () => {
                clearInterval(activeSpecPoll!);
                activeSpecPoll = null;
                dismissOverlay();
              },
              onTimeout: () => {
                clearInterval(activeSpecPoll!);
                activeSpecPoll = null;
                dismissOverlay();
                showTransient("AI did not update the spec. Press S to resubmit.", "warn", 3000);
              },
            });
            showOverlay(spinnerOverlay);

            activeSpecPoll = setInterval(() => {
              try {
                const currentMtime = statSync(specFile).mtimeMs;
                if (currentMtime !== specMtime) {
                  clearInterval(activeSpecPoll!);
                  activeSpecPoll = null;
                  const newContent = readFileSync(specFile, "utf8");
                  state.reset(newContent.split("\n"));
                  specMtime = currentMtime;
                  specMtimeChanged = false;
                  liveWatcher.stop();
                  liveWatcher.start();
                  dismissOverlay();
                  searchQuery = null;
                  jumpList.length = 0;
                  jumpList.push(1);
                  jumpIndex = 0;
                  ensureCursorVisible();
                  refreshPager();
                  showTransient("Spec rewritten \u2014 review cleared", "success", 2500);
                }
              } catch {}
            }, 500);
          });
          break;
        case "approve":
          unresolvedGate(() => {
            exitTui(resolve, "approve");
          });
          break;
        case "next-thread": {
          const nextT = state.nextThread();
          if (nextT !== null) {
            const wrapped = nextT <= state.cursorLine;
            savePrevPosition();
            state.cursorLine = nextT;
            ensureCursorVisible();
            refreshPager();
            if (wrapped) showTransient("Wrapped to first thread", "info", 1200);
          } else {
            showTransient("No threads");
          }
          break;
        }
        case "prev-thread": {
          const prevT = state.prevThread();
          if (prevT !== null) {
            const wrapped = prevT >= state.cursorLine;
            savePrevPosition();
            state.cursorLine = prevT;
            ensureCursorVisible();
            refreshPager();
            if (wrapped) showTransient("Wrapped to last thread", "info", 1200);
          } else {
            showTransient("No threads");
          }
          break;
        }
        case "next-unread": {
          const nextLine = state.nextUnreadThread();
          if (nextLine !== null) {
            savePrevPosition();
            state.cursorLine = nextLine;
            ensureCursorVisible();
            refreshPager();
          } else {
            showTransient("No unread replies");
          }
          break;
        }
        case "prev-unread": {
          const prevLine = state.prevUnreadThread();
          if (prevLine !== null) {
            savePrevPosition();
            state.cursorLine = prevLine;
            ensureCursorVisible();
            refreshPager();
          } else {
            showTransient("No unread replies");
          }
          break;
        }
        case "next-h1":
        case "next-h2":
        case "next-h3": {
          const level = parseInt(action.slice(-1));
          const next = state.nextHeading(level);
          if (next !== null) {
            savePrevPosition();
            state.cursorLine = next;
            ensureCursorVisible();
            refreshPager();
          } else {
            showTransient(`No h${level} headings`);
          }
          break;
        }
        case "prev-h1":
        case "prev-h2":
        case "prev-h3": {
          const level = parseInt(action.slice(-1));
          const prev = state.prevHeading(level);
          if (prev !== null) {
            savePrevPosition();
            state.cursorLine = prev;
            ensureCursorVisible();
            refreshPager();
          } else {
            showTransient(`No h${level} headings`);
          }
          break;
        }
        case "jump-back": {
          // '' swaps between current position and last jump entry
          if (jumpList.length > 1) {
            const cur = state.cursorLine;
            const prevIdx = jumpIndex > 0 ? jumpIndex - 1 : 0;
            const target = jumpList[prevIdx];
            // Record current position at our spot so '' can swap back
            jumpList[jumpIndex] = cur;
            jumpIndex = prevIdx;
            state.cursorLine = Math.min(target, state.lineCount);
            ensureCursorVisible();
            refreshPager();
          }
          break;
        }
        case "screen-top": {
          const topRow = pager.scrollBox.scrollTop;
          savePrevPosition();
          state.cursorLine = visualRowToSpecLine(topRow);
          refreshPager();
          break;
        }
        case "screen-middle": {
          const midRow = pager.scrollBox.scrollTop + Math.floor(pageSize() / 2);
          savePrevPosition();
          state.cursorLine = visualRowToSpecLine(midRow);
          refreshPager();
          break;
        }
        case "screen-bottom": {
          const botRow = pager.scrollBox.scrollTop + pageSize() - 1;
          savePrevPosition();
          state.cursorLine = visualRowToSpecLine(botRow);
          refreshPager();
          break;
        }
        case "help":
          showHelpOverlay();
          break;
        case "search":
          showSearchOverlay();
          break;
        case "command-mode":
          if (messageTimer) { clearTimeout(messageTimer); messageTimer = null; }
          commandBuffer = "";
          refreshPager();
          break;
      }
    });
  });
}

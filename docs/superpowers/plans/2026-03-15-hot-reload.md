# Hot-Reload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reviewer submit feedback and receive a spec rewrite without leaving the TUI. Also remove the review JSON merge concept — the JSONL is the single source of truth.

**Architecture:** Add `S` (submit for rewrite) and `A` (approve) keybindings with a shared unresolved-threads gate. Submit emits a `submit` event, shows a spinner (120s timeout), and reloads the spec when the file changes. Watch process handles `submit` as a third exit condition with resolved thread summaries and crash recovery. Remove all merge/review-JSON logic. Use nanoid for thread IDs to avoid cross-round collisions.

**Tech Stack:** Bun + TypeScript + @opentui/core (existing stack)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/protocol/live-events.ts` | Modify | Add `submit` to LiveEventType union and validation |
| `src/state/review-state.ts` | Modify | Add `reset()`, `resolveAll()`, switch to nanoid for thread IDs |
| `src/cli/watch.ts` | Modify | Handle `submit` event with crash recovery, remove reviewPath reference |
| `src/tui/app.ts` | Modify | New `S`/`A` bindings, unresolved-threads gate, spinner, spec reload, remove merge logic |
| `src/tui/spinner.ts` | Create | Spinner popup component with 120s timeout |
| `src/tui/help.ts` | Modify | Update keybinding reference, remove `:w` |
| `src/tui/status-bar.ts` | Modify | Update bottom bar hints |
| `skills/revspec/SKILL.md` | Modify | Add submit case to the loop |
| `README.md` | Modify | Update keybindings, remove merge commands |

---

## Chunk 1: Protocol + State Layer

### Task 1: Add `submit` to LiveEventType

**Files:**
- Modify: `src/protocol/live-events.ts`

- [ ] **Step 1: Add `submit` to the type union and validation**

In `LiveEventType`, add `"submit"`:
```typescript
export type LiveEventType =
  | "comment"
  | "reply"
  | "resolve"
  | "unresolve"
  | "approve"
  | "delete"
  | "round"
  | "session-end"
  | "submit";
```

Add to `VALID_LIVE_EVENT_TYPES`:
```typescript
const VALID_LIVE_EVENT_TYPES: readonly LiveEventType[] = [
  "comment", "reply", "resolve", "unresolve",
  "approve", "delete", "round", "session-end", "submit",
];
```

Add `submit` to the threadId exemption in `isValidLiveEvent`:
```typescript
// threadId required for all except approve, round, session-end, and submit
if (v.type !== "approve" && v.type !== "round" && v.type !== "session-end" && v.type !== "submit") {
```

Add `submit` to the skip case in `replayEventsToThreads`:
```typescript
case "approve":
case "round":
case "submit":
  // Skip these event types
  break;
```

- [ ] **Step 2: Run tests**

Run: `bun run test`
Expected: PASS (no behavior change, just type expansion)

- [ ] **Step 3: Commit**

```bash
git add src/protocol/live-events.ts
git commit -m "feat: add submit event type to live protocol"
```

---

### Task 2: Switch thread IDs to nanoid, add `resolveAll()` and `reset()`

**Files:**
- Modify: `src/state/review-state.ts`
- Test: `test/unit/state/review-state.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
test("thread IDs are unique random strings", () => {
  const state = new ReviewState(["a", "b", "c"], []);
  state.addComment(1, "first");
  state.addComment(2, "second");
  const id1 = state.threads[0].id;
  const id2 = state.threads[1].id;
  expect(id1).not.toBe(id2);
  expect(id1.length).toBeGreaterThan(4);
  // Should not be sequential t1/t2 format
  expect(id1.startsWith("t")).toBe(false);
});

test("resolveAll resolves all open and pending threads", () => {
  const state = new ReviewState(["a", "b", "c"], [
    { id: "x1", line: 1, status: "open", messages: [{ author: "reviewer", text: "x" }] },
    { id: "x2", line: 2, status: "pending", messages: [{ author: "reviewer", text: "y" }] },
    { id: "x3", line: 3, status: "resolved", messages: [{ author: "reviewer", text: "z" }] },
  ]);
  state.resolveAll();
  expect(state.threads[0].status).toBe("resolved");
  expect(state.threads[1].status).toBe("resolved");
  expect(state.threads[2].status).toBe("resolved");
});

test("reset clears threads and reloads spec lines", () => {
  const state = new ReviewState(["a", "b"], [
    { id: "x1", line: 1, status: "open", messages: [{ author: "reviewer", text: "x" }] },
  ]);
  state.cursorLine = 2;
  state.reset(["c", "d", "e"]);
  expect(state.threads).toEqual([]);
  expect(state.specLines).toEqual(["c", "d", "e"]);
  expect(state.cursorLine).toBe(1);
  expect(state.lineCount).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL

- [ ] **Step 3: Implement**

Replace `nextThreadId()` with nanoid:
```typescript
import { randomBytes } from "crypto";

function nanoid(size = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}
```

Update `nextThreadId()`:
```typescript
nextThreadId(): string {
  return nanoid();
}
```

Add `resolveAll()` and `reset()` after `resolveAllPending()`:

```typescript
resolveAll(): void {
  for (const thread of this.threads) {
    if (thread.status !== "resolved" && thread.status !== "outdated") {
      thread.status = "resolved";
    }
  }
}

reset(newSpecLines: string[]): void {
  this.specLines = newSpecLines;
  this.threads = [];
  this.cursorLine = 1;
  this._unreadThreadIds.clear();
}
```

- [ ] **Step 4: Fix any tests that depend on sequential `t1`/`t2` IDs**

Tests that assert `thread.id === "t1"` need to change to assert existence or use the actual ID from `state.threads[0].id`.

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/state/review-state.ts test/unit/state/review-state.test.ts
git commit -m "feat: switch to nanoid thread IDs, add resolveAll() and reset()"
```

---

## Chunk 2: Watch Submit Handling + Crash Recovery

### Task 3: Handle `submit` event in watch process

**Files:**
- Modify: `src/cli/watch.ts`
- Test: `test/integration/cli-watch.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
test("watch outputs submit message with resolved threads", async () => {
  appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 5, author: "reviewer", text: "unclear", ts: 1 });
  appendEvent(jsonlPath, { type: "reply", threadId: "x1", author: "owner", text: "will clarify", ts: 2 });
  appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 3 });
  appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 4 });

  const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  expect(proc.exitCode).toBe(0);
  expect(output).toContain("Submit: Rewrite Requested");
  expect(output).toContain("x1 (line 5)");
  expect(output).toContain("unclear");
  expect(output).toContain("will clarify");
});

test("watch recovers pending submit on restart", async () => {
  // Simulate: submit was emitted, AI crashed before rewriting
  appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 3, author: "reviewer", text: "fix this", ts: 1 });
  appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 2 });
  appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 3 });

  // First watch — consumes the submit
  let proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
  });
  await proc.exited;

  // Second watch — should re-output the pending submit
  proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  expect(output).toContain("Submit: Rewrite Requested");
  expect(output).toContain("fix this");
});

test("submit takes priority over session-end in same batch", async () => {
  appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 1, author: "reviewer", text: "change this", ts: 1 });
  appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 2 });
  appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 3 });
  appendEvent(jsonlPath, { type: "session-end", author: "reviewer", ts: 4 });

  const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  // Submit should win over session-end
  expect(output).toContain("Submit: Rewrite Requested");
  expect(output).not.toContain("Session ended");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL

- [ ] **Step 3: Implement submit handling in processNewEvents**

Reorder priority: approve > **submit** > session-end.

After the approve check, before the session-end check, add:

```typescript
// Check for submit event — priority over session-end
const hasSubmit = events.some((e) => e.type === "submit");
if (hasSubmit) {
  const { events: allEvents } = readEventsFromOffset(jsonlPath, 0);
  const roundStart = findCurrentRoundStartIndex(allEvents);
  const currentRoundThreads = replayEventsToThreads(allEvents.slice(roundStart));
  const resolved = currentRoundThreads.filter(t => t.status === "resolved");
  const output = formatSubmitOutput(resolved, specLines, specPath);
  return { approved: false, output, newOffset };
}
```

Add crash recovery at the top of `processNewEvents`, before checking for new events:

```typescript
// Recovery: detect pending unprocessed submit
if (events.length === 0) {
  const { events: allEvents } = readEventsFromOffset(jsonlPath, 0);
  const lastSubmitIdx = allEvents.findLastIndex(e => e.type === "submit");
  if (lastSubmitIdx >= 0) {
    const afterSubmit = allEvents.slice(lastSubmitIdx + 1);
    const hasNewActivity = afterSubmit.some(e =>
      e.type === "comment" || e.type === "reply" ||
      e.type === "approve" || e.type === "session-end"
    );
    if (!hasNewActivity) {
      const roundStart = findCurrentRoundStartIndex(allEvents);
      const currentRoundThreads = replayEventsToThreads(allEvents.slice(roundStart));
      const resolved = currentRoundThreads.filter(t => t.status === "resolved");
      const output = formatSubmitOutput(resolved, specLines, specPath);
      return { approved: false, output, newOffset: offset };
    }
  }
}
```

Add helpers:

```typescript
function findCurrentRoundStartIndex(events: LiveEvent[]): number {
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "submit") {
      count++;
      if (count === 2) return i + 1;
    }
  }
  return 0;
}

function formatSubmitOutput(
  resolvedThreads: Thread[],
  specLines: string[],
  specPath: string
): string {
  const lines: string[] = [];
  lines.push("=== Submit: Rewrite Requested ===");
  lines.push("");
  if (resolvedThreads.length > 0) {
    lines.push("Resolved threads:");
    for (const t of resolvedThreads) {
      const reviewerMsgs = t.messages.filter(m => m.author === "reviewer");
      const ownerMsgs = t.messages.filter(m => m.author === "owner");
      lines.push(`  ${t.id} (line ${t.line}): "${reviewerMsgs.map(m => m.text).join("; ")}"`);
      if (ownerMsgs.length > 0) {
        lines.push(`    → AI: "${ownerMsgs.map(m => m.text).join("; ")}"`);
      }
    }
    lines.push("");
  }
  lines.push(`Rewrite the spec incorporating the above, then run: revspec watch ${basename(specPath)}`);
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Remove reviewPath reference from approve output**

Change the approve output from:
```typescript
console.log(`Review approved.\nReview file: ${reviewPath}`);
```
To:
```typescript
console.log("Review approved.");
```

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/watch.ts test/integration/cli-watch.test.ts
git commit -m "feat: handle submit event with crash recovery, fix priority ordering"
```

---

## Chunk 3: Remove Merge + Simplify Exit

### Task 4: Remove merge logic, simplify exit paths in app.ts

**Files:**
- Modify: `src/tui/app.ts`

- [ ] **Step 1: Remove merge-related code**

Remove imports: `readReviewFile`, `writeReviewFile`, `mergeJsonlIntoReview`.

Remove variables/functions: `lastMergedOffset`, `hasPendingChanges()`, `doMerge()`, `mergeAndExit()`.

Remove `reviewPathForMerge` variable.

- [ ] **Step 2: Create single exit helper**

```typescript
function exitTui(resolve: () => void, eventType: "session-end" | "approve"): void {
  appendEvent(jsonlPath, { type: eventType, author: "reviewer", ts: Date.now() });
  liveWatcher.stop();
  keybinds.destroy();
  renderer.destroy();
  resolve();
}
```

- [ ] **Step 3: Update Ctrl+C handler**

```typescript
if (key.ctrl && key.name === "c") {
  exitTui(resolve, "session-end");
  return;
}
```

- [ ] **Step 4: Simplify processCommand**

```typescript
function processCommand(cmd: string, resolve: () => void): "exit" | "stay" {
  if (cmd === "q" || cmd === "wq" || cmd === "qw") {
    // Quit if all threads resolved; confirm if unresolved
    const { open, pending } = state.activeThreadCount();
    const total = open + pending;
    if (total > 0) {
      setBottomBarMessage(bottomBar, ` ⚠ ${total} unresolved thread(s). Use :q! to force quit`);
      renderer.requestRender();
      setTimeout(() => { refreshPager(); }, 2000);
      return "stay";
    }
    exitTui(resolve, "session-end");
    return "exit";
  }
  if (cmd === "q!") {
    exitTui(resolve, "session-end");
    return "exit";
  }
  // :{N} — jump to line number
  const lineNum = parseInt(cmd, 10);
  if (!isNaN(lineNum) && lineNum > 0) {
    state.cursorLine = Math.min(lineNum, state.lineCount);
    ensureCursorVisible();
    refreshPager();
    return "stay";
  }
  return "stay";
}
```

Update the command mode handler — remove `"merged"` return type handling. Only `"exit"` and `"stay"`.

- [ ] **Step 5: Remove `reviewPath` and `draftPath` from `runTui()` signature**

Update the function signature and update the caller in `bin/revspec.ts`.

- [ ] **Step 6: Run tests**

Run: `bun run test`
Expected: PASS (fix any tests that reference merge behavior)

- [ ] **Step 7: Commit**

```bash
git add src/tui/app.ts bin/revspec.ts
git commit -m "refactor: remove merge/review-JSON, simplify exit paths"
```

---

## Chunk 4: Spinner + Submit/Approve Handlers

### Task 5: Create spinner popup with timeout

**Files:**
- Create: `src/tui/spinner.ts`

- [ ] **Step 1: Create spinner component**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/spinner.ts
git commit -m "feat: add spinner popup component with timeout"
```

---

### Task 6: Add S/A keybindings and handlers

**Files:**
- Modify: `src/tui/app.ts`

- [ ] **Step 1: Add imports and bindings**

```typescript
import { createSpinner } from "./spinner";
```

Replace `{ key: "a", action: "approve" }` with:
```typescript
{ key: "S", action: "submit" },
{ key: "A", action: "approve" },
```

- [ ] **Step 2: Add unresolved-threads gate**

```typescript
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
      // Only emit resolve events for threads that aren't already resolved
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
```

- [ ] **Step 3: Add submit and approve handlers**

```typescript
case "submit":
  unresolvedGate(() => {
    appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: Date.now() });

    const spinnerOverlay = createSpinner({
      renderer,
      message: "Waiting for agent to update spec...",
      onCancel: () => {
        clearInterval(specPollInterval);
        dismissOverlay();
      },
      onTimeout: () => {
        clearInterval(specPollInterval);
        dismissOverlay();
        setBottomBarMessage(bottomBar, " ⚠ Agent did not update spec. Press S to retry.");
        renderer.requestRender();
        setTimeout(() => { refreshPager(); }, 3000);
      },
    });
    showOverlay(spinnerOverlay);

    const specPollInterval = setInterval(() => {
      try {
        const currentMtime = statSync(specFile).mtimeMs;
        if (currentMtime !== specMtime) {
          clearInterval(specPollInterval);
          const newContent = readFileSync(specFile, "utf8");
          state.reset(newContent.split("\n"));
          specMtime = currentMtime;
          specMtimeChanged = false;
          liveWatcher.stop();
          liveWatcher.start();
          dismissOverlay();
          searchQuery = null;
          ensureCursorVisible();
          refreshPager();
        }
      } catch {}
    }, 500);
  });
  break;

case "approve":
  unresolvedGate(() => {
    const confirmOverlay = createConfirm({
      renderer,
      message: "Approve spec and proceed to implementation?",
      onConfirm: () => {
        dismissOverlay();
        exitTui(resolve, "approve");
      },
      onCancel: () => {
        dismissOverlay();
      },
    });
    showOverlay(confirmOverlay);
  });
  break;
```

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/app.ts
git commit -m "feat: add submit spinner and approve handlers with unresolved gate"
```

---

## Chunk 5: Docs, Skill, Snapshots

### Task 7: Update help overlay

**Files:**
- Modify: `src/tui/help.ts`

- [ ] **Step 1: Update Review and Commands sections**

Review:
```typescript
addHelpSection(dialog.content, renderer, "Review", [
  "  c         Comment / view thread",
  "  r         Resolve thread (toggle)",
  "  R         Resolve all pending",
  "  dd        Delete thread",
  "  T         List threads",
  "  S         Submit for rewrite",
  "  A         Approve spec",
]);
```

Commands:
```typescript
addHelpSection(dialog.content, renderer, "Commands", [
  "  :q        Quit (warns if unresolved)",
  "  :q!       Force quit",
  "  :{N}      Jump to line N",
  "  Ctrl+C    Force quit",
]);
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/help.ts
git commit -m "docs: update help overlay with S/A, simplified commands"
```

---

### Task 8: Update bottom bar hints

**Files:**
- Modify: `src/tui/status-bar.ts`

- [ ] **Step 1: Add S hint**

```typescript
const hints: Hint[] = [
  { key: "j/k", action: "navigate" },
  { key: "c", action: "comment" },
];
if (hasThread) {
  hints.push({ key: "r", action: "resolve" });
}
hints.push({ key: "S", action: "submit" });
hints.push({ key: "?", action: "help" });
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/status-bar.ts
git commit -m "docs: add S hint to bottom bar"
```

---

### Task 9: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update keybindings**

Review section — remove `a`, add:
```markdown
| `S` | Submit for rewrite |
| `A` | Approve spec |
```

Commands section:
```markdown
| `:q` | Quit (warns if unresolved threads) |
| `:q!` | Force quit |
| `:{N}` | Jump to line N |
| `Ctrl+C` | Force quit |
```

Remove `:w`, `:wq`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with S/A, simplified commands"
```

---

### Task 10: Update skill file

**Files:**
- Modify: `skills/revspec/SKILL.md`

- [ ] **Step 1: Add submit case and update loop**

Add to Step 4:

```markdown
### Submit (reviewer pressed `S`)

Watch returns resolved thread summaries:

\```
=== Submit: Rewrite Requested ===

Resolved threads:
  x1a3f (line 14): "this is unclear"
    → AI: "I'll clarify the polling vs webhook distinction."

Rewrite the spec incorporating the above, then run: revspec watch spec.md
\```

1. Read the current spec and compare against the resolved threads
2. If changes are needed: rewrite the spec and save — this triggers the TUI to reload
3. If the spec already reflects the feedback (e.g., crash recovery): skip rewrite
4. Run `revspec watch` again — the reviewer is still in the TUI

**Important:** Watch may re-output the submit summary on crash recovery. Always verify
whether the spec already incorporates the feedback before rewriting.
```

Update Loop Summary:
```markdown
1. Launch revspec on spec file
2. Watch for comments
3. Reply to each comment
4. Watch again (repeat 2-3 until submit/session-end/approval)
5. On submit: verify and rewrite spec if needed (triggers TUI reload), go to step 2
6. On session-end: stop, user will invoke /revspec again if needed
7. On approval: spec is finalized, done
```

- [ ] **Step 2: Commit**

```bash
git add skills/revspec/SKILL.md
git commit -m "docs: update revspec skill with submit flow and crash recovery"
```

---

### Task 11: Update E2E snapshots

- [ ] **Step 1: Update snapshots**

Run: `bun run test:e2e -- --update-snapshots`
Expected: PASS

- [ ] **Step 2: Verify stable**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/e2e/
git commit -m "test: update E2E snapshots for hot-reload changes"
```

---

### Task 12: Manual testing

- [ ] **Step 1: Test submit flow**

1. `bun link`
2. Create test spec, launch revspec + watch
3. Comment → AI reply → resolve → `S`
4. Verify spinner, verify watch output has resolved thread summaries
5. Simulate rewrite (write new content to spec file)
6. Verify spinner dismisses, spec reloads, threads cleared

- [ ] **Step 2: Test spinner timeout**

1. Press `S` but don't rewrite the spec
2. Wait 120s — spinner should dismiss with "Agent did not update spec" message

- [ ] **Step 3: Test approve flow**

1. `A` → confirm → exit
2. Verify JSONL has approve event

- [ ] **Step 4: Test unresolved gate**

1. Comment without resolving → `S` → "unresolved" popup
2. `n` cancels, `y` resolves all and proceeds

- [ ] **Step 5: Test `:q` with unresolved threads**

1. Comment without resolving → `:q` → warns about unresolved
2. `:q!` → force quits

- [ ] **Step 6: Test crash recovery**

1. Submit, kill the AI before it rewrites
2. Re-run `revspec watch` — should re-output the submit summary

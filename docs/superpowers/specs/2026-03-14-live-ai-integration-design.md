# Revspec — Live AI Integration Design

Real-time human-AI conversation within the revspec TUI. Instead of batch review rounds (comment → exit → AI processes → relaunch), the human comments and the AI replies immediately — like a chatroom anchored to specific lines in the spec. The spec stays frozen during discussion; once all threads are resolved, the AI rewrites the spec and a new review round begins.

## Problem

Revspec's current workflow is round-based: the human adds all comments, exits the TUI, the AI processes everything, rewrites the spec, and relaunches. This breaks the "immediate feedback" promise — the human waits for the AI between rounds, and the AI can't ask clarifying questions until the next round.

The selling point is that AI replies instantly. But today, the review checks multiple places, adds comments, and submits through rounds with no immediate feedback.

## Solution

Make the review session live. The human stays in revspec for the entire session. Comments trigger immediate AI responses that appear in-thread. The human resolves, continues, or moves on. When all discussions settle and the human approves, the AI rewrites the spec and launches a new round.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Human in revspec TUI (terminal / tmux pane)            │
│                                                         │
│  comments ──► writes to JSONL ──► AI detects change     │
│                                        │                │
│  sees reply ◄── reads from JSONL ◄── AI appends reply   │
│                                                         │
│  resolves threads ──► approves ──► exits                │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  AI coding tool (Claude Code, opencode, etc.)           │
│                                                         │
│  runs: revspec watch spec.md    (blocks until comments) │
│  gets: new human comments (structured output)           │
│  runs: revspec reply spec.md t1 "response text"         │
│  runs: revspec watch spec.md    (loop)                  │
│                                                         │
│  on approval: rewrites spec, launches new round         │
└─────────────────────────────────────────────────────────┘
```

The two sides communicate through a shared JSONL file. Revspec owns the protocol entirely — the AI tool just runs CLI commands and follows instructions in the output.

## Live Communication Protocol (JSONL)

### File

`spec.review.live.jsonl` — sibling to the spec file. Append-only audit log. Never modified or truncated. Persists after the session ends.

```
docs/specs/feature-design.md
docs/specs/feature-design.review.json          # structured state (persists across rounds)
docs/specs/feature-design.review.live.jsonl    # live chat log (append-only audit trail)
```

### Event Types

```jsonl
{"type":"comment","threadId":"t1","line":14,"author":"reviewer","text":"this section is unclear","ts":1710400000}
{"type":"reply","threadId":"t1","author":"owner","text":"I can restructure around X...","ts":1710400005}
{"type":"resolve","threadId":"t1","author":"reviewer","ts":1710400010}
{"type":"unresolve","threadId":"t1","author":"reviewer","ts":1710400015}
{"type":"reply","threadId":"t1","author":"reviewer","text":"actually what about Y?","ts":1710400020}
{"type":"reply","threadId":"t1","author":"owner","text":"Y works, here's how...","ts":1710400025}
{"type":"resolve","threadId":"t1","author":"reviewer","ts":1710400030}
{"type":"comment","threadId":"t2","line":38,"author":"reviewer","text":"missing error case","ts":1710400035}
{"type":"reply","threadId":"t2","author":"owner","text":"good catch, I'll add...","ts":1710400040}
{"type":"resolve","threadId":"t2","author":"reviewer","ts":1710400045}
{"type":"approve","author":"reviewer","ts":1710400050}
```

### Event Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `comment`, `reply`, `resolve`, `unresolve`, `approve`, `delete`, `round` |
| `threadId` | string | yes (except `approve` and `round`) | Thread identifier (e.g., `t1`) |
| `line` | integer | only for `comment` | 1-indexed line anchor in spec |
| `author` | string | yes | `reviewer` or `owner` |
| `text` | string | only for `comment`/`reply` | Message content |
| `ts` | integer | yes | `Date.now()` timestamp |
| `round` | integer | only for `round` | Round number (1-indexed) |

### Rules

- Append-only — neither side edits or truncates the file
- `comment` creates a new thread; `reply` adds to an existing one
- Only reviewers create threads (owners only reply)
- Thread IDs are auto-incremented by the TUI (`t1`, `t2`, ...). IDs are globally unique across rounds because `nextThreadId()` scans all threads from both the review JSON (prior rounds) and the replayed JSONL (current session) to find the highest existing ID.
- `approve` signals the session is complete
- Write atomicity: each event is a single `appendFileSync` call with a trailing `\n`. On read, discard any final line that does not parse as valid JSON (partial write from crash/kill).

### Change Detection

Both sides track their read position by **byte offset** (not timestamp). Each reader remembers the last byte offset it read to. On file change notification, it reads from that offset forward, parses new lines, and updates the offset.

- The `watch` CLI stores its byte offset in a state file: `spec.review.live.offset` (deleted on session end)
- The TUI tracks its offset in memory (lives as long as the process)
- Byte offset is more reliable than timestamp — no risk of two events sharing the same millisecond
- **Alignment safety:** after seeking to a byte offset, skip to the next `\n` boundary before parsing (discard any partial first line). This handles the case where the offset lands mid-line due to a concurrent write. The first read always starts at byte 0 so no alignment is needed.

### Concurrency Model

This is a deliberate departure from the original spec's single-writer contract. Both the TUI and the AI tool append to the same JSONL file concurrently. This is safe because:

1. Each write is a single `appendFileSync` call (atomic for small writes on local filesystems)
2. Each event is a complete JSON line — partial writes are detectable and discarded
3. Neither side edits or truncates — append-only eliminates read-modify-write races
4. The JSONL is a log, not a state file — order of concurrent appends does not affect correctness

### Thread Status Mapping

During a live session, thread status is derived from the JSONL event stream:

| Last event on thread | Derived status |
|---------------------|----------------|
| `comment` (reviewer) | `open` (owner's turn) |
| `reply` (reviewer) | `open` (owner's turn) |
| `reply` (owner) | `pending` (reviewer's turn) |
| `resolve` | `resolved` |
| `unresolve` (reviewer) | `open` (owner's turn — reviewer reopened the thread) |
| `delete` (reviewer) | status unchanged (message removed, thread state unaffected unless last message deleted — see Delete Behavior) |

The `outdated` status is not used during live sessions (the spec is frozen, no anchors move). It is set by the AI between rounds when rewriting the spec and updating anchors.

### Delete Behavior (`dd` in live mode)

In batch mode, `dd` deletes the last draft message from in-memory state. In live mode, the message has already been appended to the JSONL and may have been seen by the AI watcher.

Live mode behavior: `dd` appends a `delete` event to the JSONL:

```jsonl
{"type":"delete","threadId":"t1","author":"reviewer","ts":1710400060}
```

This signals that the last reviewer message on the thread should be treated as retracted. The merge step excludes deleted messages from the final JSON. The `watch` command, on seeing a `delete` event, includes it in its output so the owner knows to disregard the deleted comment:

```
--- Deleted ---
[t1] line 14: reviewer retracted last message
```

If the AI has already replied to the deleted comment, the AI's reply remains in the JSONL (append-only). The human can resolve the thread to dismiss both.

If `delete` removes the only message in a thread (thread was just created), the thread is effectively empty and excluded from the merge.

### AI Reply to Resolved Thread

If the AI replies to a thread that was resolved after the comment was posted (race condition — human resolves while AI is composing), the reply is still appended to the JSONL. The thread status reverts to `pending` (the AI reply is the latest event). The TUI shows the new AI reply with an unread indicator. The human can re-resolve if the reply doesn't need further discussion.

### Merge to JSON

On session end (approve or quit), revspec replays the **entire JSONL from byte 0** and merges the final thread state into `spec.review.json`. The JSONL file is kept as an audit log.

The merge always replays from the start (not from an offset) to ensure it is idempotent and self-healing — even if an AI reply lands during the merge, the next merge will capture it.

**Merge semantics:**
- Existing threads in `spec.review.json` (from prior rounds) are preserved
- JSONL threads are merged by ID: if a thread ID exists in both, messages from the JSONL are appended to the existing thread's messages (same logic as the current `mergeDraftIntoReview`)
- Thread status is set to whatever the JSONL's final event derives (see Thread Status Mapping)
- Thread IDs use the `t`-prefix format (`t1`, `t2`, ...) — this matches the existing codebase. The original spec's examples showing plain numeric IDs (`"1"`, `"2"`) are outdated.

The merge produces the same structured `ReviewFile` format used today:

```json
{
  "file": "spec.md",
  "threads": [
    {
      "id": "t1",
      "line": 14,
      "status": "resolved",
      "messages": [
        { "author": "reviewer", "text": "this section is unclear", "ts": 1710400000 },
        { "author": "owner", "text": "I can restructure around X...", "ts": 1710400005 },
        { "author": "reviewer", "text": "actually what about Y?", "ts": 1710400020 },
        { "author": "owner", "text": "Y works, here's how...", "ts": 1710400025 }
      ]
    }
  ]
}
```

The `Message` type in the review JSON gains an optional `ts` field:

```typescript
interface Message {
  author: "reviewer" | "owner"
  text: string
  ts?: number  // Date.now(), carried over from JSONL during merge. Optional for backward compat with pre-live review files.
}
```

Timestamps are preserved from the JSONL into the merged JSON, giving the review file a built-in history timeline without needing to consult the JSONL audit log.

### Draft File Replacement

The live JSONL replaces the draft file (`spec.review.draft.json`) entirely. In the original design, the draft was an in-progress snapshot that merged on exit. In live mode, the JSONL is the in-progress log and the merge-on-exit step replays it into the review JSON. There is no need for both.

- Old flow: TUI → draft.json → merge into review.json on exit
- Live flow: TUI → live.jsonl ← AI also writes here → merge into review.json on exit

If revspec is launched without an AI watcher (standalone mode), the JSONL still works — it just never receives AI replies. The merge step is identical.

## CLI Subcommands

Two new subcommands for AI tool integration. Revspec owns the protocol — the AI tool just follows instructions in the output.

### `revspec watch <file.md>`

Blocks until new human events appear in the JSONL. Returns structured output with the new comments, spec context, thread history, and instructions for how to respond.

**Full output example — new comments with context:**

```
$ revspec watch spec.md

# Blocks... human adds comments in TUI...

--- New threads ---

[t1] line 14 (new):
  Context:
    12: The system uses polling to check for updates
    13: every 30 seconds. If a change is detected,
   >14: it sends a notification via webhook.
    15: The notification payload includes the full
    16: resource state.
  Comment: "this section is unclear — polling or webhook?"

[t2] line 38 (new):
  Context:
    36: ### Error Handling
    37: Errors are logged to stderr.
   >38: No retry logic is implemented.
    39:
    40: ### Rate Limiting
  Comment: "missing error case — what about network timeouts?"

To reply: revspec reply spec.md <threadId> "<your response>"
When done replying, run: revspec watch spec.md
```

**Full output example — replies to existing threads:**

```
$ revspec watch spec.md

--- Replies ---

[t1] line 14 (reply):
  Thread history:
    reviewer: "this section is unclear — polling or webhook?"
    owner: "Good catch. I'll clarify — it uses polling to detect changes, then sends a webhook notification."
    reviewer: "that still doesn't explain the 30-second interval — why not event-driven?"
  Comment: "that still doesn't explain the 30-second interval — why not event-driven?"

To reply: revspec reply spec.md <threadId> "<your response>"
When done replying, run: revspec watch spec.md
```

**Full output example — resolves (informational, no reply needed):**

```
$ revspec watch spec.md

--- Resolved ---

[t2] line 38: resolved by reviewer

--- Replies ---

[t1] line 14 (reply):
  Thread history:
    reviewer: "polling or webhook?"
    owner: "It's event-driven now. Changed the spec."
    reviewer: "perfect, but update the diagram too"
  Comment: "perfect, but update the diagram too"

To reply: revspec reply spec.md <threadId> "<your response>"
When done replying, run: revspec watch spec.md
```

**Output on approval:**

```
$ revspec watch spec.md

Review approved.
Review file: docs/specs/feature-design.review.json
```

**Output format notes:**
- Context shows 2 lines above and below the anchored line (marked with `>`)
- Thread history shows the full conversation so the AI has context for its reply
- Resolved threads are listed separately — informational only, no reply expected
- Unresolve events are not surfaced to the AI (the next human reply will trigger a new watch return)
- The output is human-readable text, not JSON — AI tools parse natural language well, and this format is easier to debug

**Behavior:**
- Reads JSONL from last-known byte offset stored in `spec.review.live.offset` (created on first call, deleted on session end)
- Filters for new `author: "reviewer"` events (comments, replies, resolves)
- Blocks (via `fs.watch()` on the JSONL file) until new human events arrive
- If JSONL file does not exist yet, blocks until it appears (human has not launched revspec yet)
- Outputs human events in a structured, AI-readable format (human-readable text, not JSON — AI tools parse natural language well)
- Includes self-describing instructions so the AI knows what to do next
- Includes spec context around each comment (surrounding lines) and full thread history so the AI can reply without reading extra files
- Exits after outputting (AI re-spawns for the next batch)
- Falls back to polling (check file mtime every 500ms) if `fs.watch()` does not fire within 2 seconds — guards against known `fs.watch` reliability issues on macOS/Linux
- Detects session end by seeing an `approve` event in the JSONL — outputs "Review approved" and exits

**Single watcher enforcement:**

Only one `revspec watch` process is supported at a time. On first invocation, `watch` creates a lock file (`spec.review.live.lock`) containing the PID of the process. On subsequent invocations:
- If the lock file exists and the PID is alive: exit with code 3 (`"Another watch process is already running"`)
- If the lock file exists but the PID is dead: stale lock — delete and proceed (handles AI tool crashes)

The lock file is deleted when `watch` outputs "Review approved" (session complete). Between `watch` invocations within the same session (watch exits after outputting, AI re-spawns), the lock is **not** deleted — the new `watch` process overwrites the lock with its own PID.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | New comments returned, or review approved (distinguish by parsing output) |
| 1 | Spec file not found or invalid |
| 2 | JSONL file corrupted (unrecoverable) |
| 3 | Another watch process is already running |

### `revspec reply <file.md> <threadId> "<text>"`

Appends an AI reply event to the JSONL. The TUI picks it up via its file watcher.

```bash
$ revspec reply spec.md t1 "I can restructure this section around X. The key change would be..."
```

**Behavior:**
- Validates the thread ID exists in the JSONL
- Rejects empty text (exit 1)
- Appends a `{"type":"reply","threadId":"...","author":"owner","text":"...","ts":...}` line. Newlines in text are preserved via JSON string escaping (`\n`).
- Replying to a resolved thread is allowed — the thread reverts to `pending` (see AI Reply to Resolved Thread). No warning is printed.
- Exits immediately (exit 0 on success, exit 1 if thread ID not found or empty text)
- The TUI detects the file change and renders the AI reply

**Malformed event handling (TUI side):**
- Events that fail JSON parsing: discarded (partial write)
- Events with unknown `threadId`: ignored (logged to stderr if `REVSPEC_DEBUG=1`)
- Events with missing required fields: ignored

### Why This Design

The AI tool's job is trivial:
1. Run `revspec watch` (blocks until comments)
2. Read the output (structured, self-describing)
3. Run `revspec reply` for each comment
4. Run `revspec watch` again (loop)

No knowledge of JSONL, timestamps, file formats, or revspec internals needed. Any AI tool that can run shell commands works — Claude Code, opencode, Cursor, etc.

### AI Context Model

**During the loop:** the AI gets incremental context from each `watch` return. Each batch includes full thread history for active threads, so the AI has enough context to reply without reading extra files. The AI does not need to track cumulative state — `watch` provides everything needed per batch.

**On approval (spec rewrite):** the AI reads `spec.review.json` (the merged final state) for a full snapshot of all threads and their resolutions. This is the authoritative source for what feedback to incorporate into the spec rewrite.

## Mode Detection and Startup

There is no separate "live mode" flag. The TUI always writes to the JSONL and always watches it for AI replies. If no AI is watching, the JSONL just accumulates human events and no AI replies arrive — this is functionally equivalent to the old batch mode.

### Startup sequence

1. TUI creates `spec.review.live.jsonl` if it does not exist
2. If `spec.review.json` exists (prior round), load existing threads into `ReviewState`
3. If `spec.review.live.jsonl` already has content (crashed previous session or continuation), replay events from byte 0 to reconstruct thread state, merging with any threads loaded from the JSON. This handles crash recovery — the JSONL is the in-progress log.
4. Start `fs.watch()` on the JSONL file for incoming AI replies
5. The draft file (`spec.review.draft.json`) is not read or written in live mode. If one exists from a pre-live version of revspec, it is ignored (the user can delete it manually).

### Session boundaries

- A **session** starts when the TUI creates or opens the JSONL file
- A **session** ends when the TUI merges the JSONL into the JSON (on `:q` or `a`)
- Between sessions (AI is rewriting the spec), the JSONL persists as an audit log
- When the AI launches a new round, a `{"type":"round","round":2,"ts":...}` marker is appended to the JSONL before the TUI starts. This separates rounds in the audit log. Line anchors in events from prior rounds refer to the previous version of the spec — the JSON (not the JSONL) is the source of truth for current thread state.
- On `:q!` (quit without merging), the JSONL persists. If the human relaunches revspec, the JSONL is replayed from byte 0 to restore thread state (crash recovery).

### Spec file mutation guard

The spec file is frozen during a live session. Revspec records the spec file's mtime on startup. If the mtime changes during the session (someone edited the file), the TUI shows a warning in the status bar: `"Spec file changed externally — line anchors may be stale"`. It does not exit or block — the human decides what to do.

## TUI Changes

### File Watcher for AI Replies

The TUI watches `spec.review.live.jsonl` via `fs.watch()`. On change:
1. Read new lines from last byte offset
2. Filter for `author: "owner"` events
3. Update thread state in `ReviewState` (add message, update indicators)
4. Re-render affected components

### Thread Indicators

New "unread AI reply" state for threads:

| Indicator | Meaning |
|-----------|---------|
| `[*]` or distinct color | Thread has an unread AI reply |
| Standard indicators | Existing open/pending/resolved/outdated states |

Viewing a thread (pressing `c` on its line) clears the "unread" state.

### Status Bar

The status bar shows new AI reply count:

```
Threads: 1 open, 2 resolved | 2 new AI replies
```

The count decreases as the human views threads.

### Navigation

New keybinding `]r`/`[r` to jump to next/prev thread with unread AI replies. Existing `]t`/`[t` (next/prev active thread) and `n`/`N` (search result cycling) are unchanged.

### Quit Semantics in Live Mode

In the original batch mode, `:q` submits comments (they weren't live until then). In live mode, comments are already live via the JSONL — there is nothing to "submit."

| Command | Live mode behavior |
|---------|-------------------|
| `:q` | Merge JSONL → JSON (full replay from byte 0), exit. Warn if unresolved threads exist. Note: an AI reply that lands after the merge completes but before the process exits will be in the JSONL but not the JSON — the next session's startup replay will capture it. |
| `:wq` | Same as `:q` (no separate "save" step — JSONL is already persisted) |
| `:q!` | Exit without merging JSONL → JSON. JSONL is preserved as audit log. |
| `a` (approve) | Append `approve` event to JSONL, merge JSONL → JSON, exit. Requires all threads resolved/outdated. |

### No Changes To

- Comment input (`c` flow — same)
- Resolve/unresolve (`r` flow — same)
- Search (`/`, `n`/`N` — same)
- Help, theme

## Launch Strategy

### With tmux (`$TMUX` set)

The AI tool splits a tmux pane and launches revspec automatically:

```bash
tmux split-window -v "revspec spec.md"
```

Human reviews in one pane, AI runs in the other.

### Without tmux

The AI tool instructs the human:

```
Please run in another terminal: revspec spec.md
```

Then starts `revspec watch spec.md`, which blocks until the JSONL file appears (signals revspec is running).

### Both converge to the same watch/reply loop.

## Full Lifecycle

```
1. AI generates/updates spec → spec.md
2. AI launches revspec (tmux pane or manual instruction)
3. AI runs: revspec watch spec.md (blocks)
4. Human reads spec, comments on lines
5. revspec watch returns with new comments
6. AI runs: revspec reply spec.md t1 "response..."
7. AI runs: revspec reply spec.md t2 "response..."
8. TUI shows AI replies (thread indicators + status bar)
9. AI runs: revspec watch spec.md (blocks again)
10. Human reads AI replies, resolves or continues discussion
11. Repeat steps 5-10 until all threads resolved
12. Human approves (a) → revspec watch returns "Review approved"
13. AI reads spec.review.json (merged from JSONL)
14. AI rewrites spec incorporating all feedback
15. AI launches new revspec session with updated spec
16. Repeat from step 3 until clean approval (no comments)
```

## Tool-Agnostic Design

Revspec is deliberately decoupled from any specific AI coding tool:

| Layer | Tool-specific? |
|-------|---------------|
| JSONL protocol | No — generic file format |
| `revspec watch` / `revspec reply` CLI | No — any tool that runs shell commands |
| TUI file watcher + hot reload | No — watches the JSONL, doesn't care who writes to it |
| Orchestration (launch, loop, spec rewrite) | Yes — each AI tool needs its own wrapper |

For Claude Code, the orchestration is a `/review` skill. Other tools would implement their own equivalent. The revspec side is identical regardless.

## Backward Compatibility

### Standalone Mode

If revspec is launched without an AI watcher (`revspec spec.md` with no `revspec watch` running), the JSONL is still written on every human action. It just never receives AI replies. The merge step on exit works identically. This means the old batch workflow still works — the human comments, exits, and the AI processes the review JSON as before.

### Existing Review Files

The `Message` type changes `author` values from `"human" | "ai"` to `"reviewer" | "owner"`. Existing `spec.review.json` files using the old values will need a one-time migration (find-and-replace in the JSON). The `ts` field is optional — existing messages without timestamps continue to work; new messages from live sessions include them.

## Open Questions

- **Bash timeout on `revspec watch`:** Claude Code's background Bash has a max 10-minute timeout. If the human takes longer, the watcher times out. The orchestration skill should re-spawn on timeout.
- **Concurrent replies:** If the human adds 3 comments quickly, the `watch` command batches all new events and returns them together. The AI can reply to all at once.
- **JSONL across rounds:** Each review round appends to the same JSONL file. The audit log shows the full history across all rounds. A `{"type":"round","round":N,"ts":...}` marker is appended by the orchestration layer before each new round (see Session Boundaries).

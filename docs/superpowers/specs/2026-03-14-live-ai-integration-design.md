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
{"type":"comment","threadId":"t1","line":14,"author":"human","text":"this section is unclear","ts":1710400000}
{"type":"reply","threadId":"t1","author":"ai","text":"I can restructure around X...","ts":1710400005}
{"type":"resolve","threadId":"t1","author":"human","ts":1710400010}
{"type":"unresolve","threadId":"t1","author":"human","ts":1710400015}
{"type":"reply","threadId":"t1","author":"human","text":"actually what about Y?","ts":1710400020}
{"type":"reply","threadId":"t1","author":"ai","text":"Y works, here's how...","ts":1710400025}
{"type":"resolve","threadId":"t1","author":"human","ts":1710400030}
{"type":"comment","threadId":"t2","line":38,"author":"human","text":"missing error case","ts":1710400035}
{"type":"reply","threadId":"t2","author":"ai","text":"good catch, I'll add...","ts":1710400040}
{"type":"resolve","threadId":"t2","author":"human","ts":1710400045}
{"type":"approve","author":"human","ts":1710400050}
```

### Event Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `comment`, `reply`, `resolve`, `unresolve`, `approve` |
| `threadId` | string | yes (except `approve`) | Thread identifier (e.g., `t1`) |
| `line` | integer | only for `comment` | 1-indexed line anchor in spec |
| `author` | string | yes | `human` or `ai` |
| `text` | string | only for `comment`/`reply` | Message content |
| `ts` | integer | yes | `Date.now()` timestamp |

### Rules

- Append-only — neither side edits or truncates the file
- `comment` creates a new thread; `reply` adds to an existing one
- Only humans create threads (AI only replies)
- `ts` is `Date.now()` — each side tracks its last-read timestamp to find new events
- Thread IDs are auto-incremented by the TUI (`t1`, `t2`, ...)
- `approve` signals the session is complete

### Merge to JSON

On session end (approve or quit), revspec replays the JSONL events and merges the final thread state into `spec.review.json`. The JSONL file is kept as an audit log.

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
        { "author": "human", "text": "this section is unclear", "ts": 1710400000 },
        { "author": "ai", "text": "I can restructure around X...", "ts": 1710400005 },
        { "author": "human", "text": "actually what about Y?", "ts": 1710400020 },
        { "author": "ai", "text": "Y works, here's how...", "ts": 1710400025 }
      ]
    }
  ]
}
```

The `Message` type gains a `ts` field:

```typescript
interface Message {
  author: "human" | "ai"
  text: string
  ts: number  // Date.now()
}
```

## CLI Subcommands

Two new subcommands for AI tool integration. Revspec owns the protocol — the AI tool just follows instructions in the output.

### `revspec watch <file.md>`

Blocks until new human events appear in the JSONL. Returns structured output with the new comments and instructions for how to respond.

```bash
$ revspec watch spec.md

# Blocks... human adds comments in TUI...

New comments:
- [t1] line 14: "this section is unclear"
- [t2] line 38: "missing error case"

To reply: revspec reply spec.md <threadId> "<your response>"
When done replying, run: revspec watch spec.md
```

When the human approves:

```bash
$ revspec watch spec.md

Review approved.
Review file: docs/specs/feature-design.review.json
```

**Behavior:**
- Reads JSONL from last-known byte offset (or from start on first call)
- Filters for new `author: "human"` events (comments, replies, resolves)
- Blocks (via `fs.watch()` on the JSONL file) until new human events arrive
- Outputs human events in a structured, AI-readable format
- Includes self-describing instructions so the AI knows what to do next
- Exits after outputting (AI re-spawns for the next batch)

### `revspec reply <file.md> <threadId> "<text>"`

Appends an AI reply event to the JSONL. The TUI picks it up via its file watcher.

```bash
$ revspec reply spec.md t1 "I can restructure this section around X. The key change would be..."
```

**Behavior:**
- Validates the thread ID exists in the JSONL
- Appends a `{"type":"reply","threadId":"...","author":"ai","text":"...","ts":...}` line
- Exits immediately
- The TUI detects the file change and renders the AI reply

### Why This Design

The AI tool's job is trivial:
1. Run `revspec watch` (blocks until comments)
2. Read the output (structured, self-describing)
3. Run `revspec reply` for each comment
4. Run `revspec watch` again (loop)

No knowledge of JSONL, timestamps, file formats, or revspec internals needed. Any AI tool that can run shell commands works — Claude Code, opencode, Cursor, etc.

## TUI Changes

### File Watcher for AI Replies

The TUI watches `spec.review.live.jsonl` via `fs.watch()`. On change:
1. Read new lines from last byte offset
2. Filter for `author: "ai"` events
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

`n`/`N` (next/prev thread) prioritize threads with unread AI replies. After all unread threads are visited, `n`/`N` cycle through remaining active threads as today.

### No Changes To

- Comment input (`c` flow — same)
- Resolve/unresolve (`r` flow — same)
- Approve flow (`a` — same, all threads must be resolved/outdated)
- Quit (`:wq` merges JSONL → JSON on exit)
- Search, help, theme

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

## Open Questions

- **Bash timeout on `revspec watch`:** Claude Code's background Bash has a max 10-minute timeout. If the human takes longer, the watcher times out. The skill should re-spawn on timeout.
- **Concurrent replies:** If the human adds 3 comments quickly, should the AI reply to all 3 at once or one at a time? Likely all at once (the `watch` command batches all new events).
- **Thread context for AI:** The `watch` output should include enough context (spec lines around the thread, full thread history) for the AI to generate a good reply without reading extra files.
- **JSONL rotation across rounds:** Should each review round get a fresh JSONL file, or does one file accumulate across all rounds? If accumulated, the audit log shows the full history. If rotated, files stay smaller.

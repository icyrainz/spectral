# Spectral — Design

A review tool for AI-generated spec documents. Unlike traditional spec review (human reviews, human author edits), the author here is an AI — it reads structured feedback and acts on every comment instantly. This enables multiple review rounds in a single sitting, with the human's only job being to give feedback.

## Problem

In AI-assisted development (e.g., Claude Code's superpowers workflow), the AI generates spec documents that need human review before implementation. The current review step breaks the agentic loop — the user has to open the markdown file separately, read it, then type unstructured feedback in the terminal. There's no way to attach comments inline, highlight regions, or give feedback the AI can precisely act on.

Traditional review tools (Google Docs, PR reviews) are designed for human-to-human workflows. They optimize for discussion, consensus, and collaborative editing. But when the spec author is an AI, the workflow is fundamentally different: the human only comments, the AI always edits, and turnaround is instant.

## Solution

A CLI tool (`spectral`) that opens a spec file in a reviewable UI, lets the user add line-anchored comments, and outputs structured JSON on close. The AI reads the JSON, addresses each comment, updates the spec, and re-invokes the review tool — completing the human-AI feedback loop in seconds rather than days.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Protocol: JSON schema (language-agnostic)   │
├──────────────────────────────────────────────┤
│  CLI: spectral <file> [--tui|--nvim|--web]   │
├──────────┬──────────────┬────────────────────┤
│ Built-in │ Neovim Plugin│  Web UI            │
│ TUI      │ (Lua)        │  (React/Express)   │
│ v1       │ v2           │  v2                │
└──────────┴──────────────┴────────────────────┘
```

Three layers:

- **Protocol** — A JSON schema defining review comments. Language-agnostic. Any UI that outputs this format works with Claude Code.
- **CLI** — Node-based entry point. Manages file lifecycle (draft/final/resume/cleanup), spawns the chosen UI, blocks until review is done, prints the output path.
- **UI Adapters** — Built-in TUI pager (v1), neovim plugin (v2), web UI (v2), future touch/iPad client. Each reads the spec + existing review threads, lets the user add messages, writes to the draft JSON.

## Protocol

### Review File Format (JSON)

The review file is a JSON document with threads as first-class objects. The AI reads and rewrites this file (to update anchors, add responses, set statuses). The human UI writes to a separate draft file that the CLI merges in.

```json
{
  "file": "docs/specs/2026-03-14-feature-design.md",
  "threads": [
    {
      "id": "1",
      "line": 12,
      "status": "addressed",
      "messages": [
        { "author": "human", "text": "why webhook not polling?" },
        { "author": "ai", "text": "Changed to polling. Good call." }
      ]
    },
    {
      "id": "2",
      "line": 52,
      "startChar": 10,
      "endChar": 17,
      "status": "discussed",
      "messages": [
        { "author": "human", "text": "this term is ambiguous" },
        { "author": "ai", "text": "I think it's clear because X" }
      ]
    },
    {
      "id": "3",
      "startLine": 20,
      "startChar": 0,
      "endLine": 28,
      "endChar": 40,
      "status": "open",
      "messages": [
        { "author": "human", "text": "this whole section needs rethinking" }
      ]
    },
    {
      "id": "4",
      "quotedText": "The webhook system should handle retry logic",
      "status": "addressed",
      "messages": [
        { "author": "human", "text": "can we use polling instead?" },
        { "author": "ai", "text": "Done — switched to polling." }
      ]
    }
  ]
}
```

**Thread model:** Each thread is an object with an anchor, a status, and an ordered array of messages. The AI can update anchors directly (e.g., after editing the spec shifts line numbers) without appending workaround messages.

### Thread Statuses

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `open` | Unaddressed (default on creation, or human reopens) | Human |
| `addressed` | AI changed the spec for this | AI |
| `discussed` | AI responded without changing | AI |
| `resolved` | Human accepts, done | Human |
| `outdated` | Anchor target was removed from spec | AI |

The review is complete when every thread is either `addressed`, `resolved`, or `outdated`. Threads in `discussed` state require human action — the human must either `resolve` (accept the AI's explanation) or reply to reopen as `open`. Claude Code should prompt the user about any remaining `discussed` threads.

### Anchor Reanchoring

When the AI edits the spec, it updates thread anchors in the review file:

- **Line shifted** — AI updates the `line`/`startLine`/`endLine` fields to new positions
- **Line modified** — AI keeps the anchor (thread is still relevant there)
- **Line removed** — AI sets status to `outdated`, moves anchor to nearest relevant line or end of file

### Anchor Types

| Type | Fields | Source | Use Case |
|------|--------|--------|----------|
| Line | `line` | TUI, Neovim, Web | Comment on a whole line |
| Span | `line`, `startChar`, `endChar` | TUI, Neovim, Web | Highlight characters within a line |
| Region | `startLine`, `startChar`, `endLine`, `endChar` | Web (drag), Touch | Multi-line selection |
| Quoted | `quotedText` | Google Docs, any UI without line resolution | Text-anchored comment |

Anchor fields live on the thread object, not on individual messages. All four strategies use consistent field naming. `quotedText` can appear alongside a positional anchor for redundancy.

### Thread Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Thread identifier |
| `status` | string | yes | `open`, `addressed`, `discussed`, `resolved`, `outdated` |
| `messages` | array | yes | Ordered list of `{ author, text }` objects |
| `line` | integer (1-indexed) | anchor | Line number for line or span anchors |
| `startChar` | integer (0-indexed) | no | Start character offset |
| `endChar` | integer (0-indexed) | no | End character offset (exclusive) |
| `startLine` | integer (1-indexed) | anchor | Start line for region anchors |
| `endLine` | integer (1-indexed) | anchor | End line for region anchors (inclusive) |
| `quotedText` | string | anchor | Text-anchored comment |

**Anchor rules:** Each thread must have at least one anchor: a positional anchor (`line`, `startLine`/`endLine`), a `quotedText` anchor, or both. `line` and `startLine`/`endLine` are mutually exclusive — use `line` for single-line anchors (with optional `startChar`/`endChar` for span), use `startLine`/`endLine` for multi-line regions. For span anchors, both `startChar` and `endChar` must be present.

### File Naming

Review file lives next to the spec:

```
docs/specs/2026-03-14-feature-design.md
docs/specs/2026-03-14-feature-design.review.json          # the review
docs/specs/2026-03-14-feature-design.review.draft.json    # in-progress (human hasn't submitted yet)
```

No round numbers — the file is a living conversation. Git tracks history.

The human UI writes only to the draft file. The CLI merges the draft into the review file. The AI reads and rewrites the review file directly (to update anchors, add responses, set statuses).

### Thread ID Generation

Simple incrementing strings: `"1"`, `"2"`, `"3"`, etc. The UI reads the highest existing `id` in the review + draft files and increments. The AI does the same when creating new threads. No collision risk — only one writer at a time (see Concurrency below).

### Concurrency

Single-writer contract. The human UI and the AI never write concurrently — the workflow alternates: human reviews (CLI blocks) → CLI merges draft → AI reads and rewrites review file → AI invokes CLI again → human reviews. If this assumption is violated, the file may be corrupted.

## CLI

### Usage

```bash
spectral <file.md>          # opens with default UI (TUI)
spectral <file.md> --tui    # explicit TUI (default)
spectral <file.md> --nvim   # neovim plugin (v2)
spectral <file.md> --web    # web UI (v2)
```

### Responsibilities

1. Validate the spec file exists and is readable; exit 1 with error message if not
2. Check for `.review.draft.json` — if exists, validate it's parseable JSON. If corrupted, warn the user ("Draft file corrupted, starting fresh") and delete it. If valid, pass to UI for resume
3. Open the chosen UI, passing: spec file path, review file path, draft file path (see CLI→Plugin Interface below)
4. Block until the UI exits
5. Read the draft file. If it contains `"approved": true`, this is an approval (see Approve Mechanism below). Otherwise, merge threads into `.review.json` (add new threads, append new messages to existing threads). Delete the draft.
6. Output to stdout and exit:
   - **Approved:** print `APPROVED: <review-file-path>` and exit 0
   - **Has review file:** print `<review-file-path>` and exit 0 (there may be `discussed` threads needing attention)
   - **No review file:** print nothing and exit 0 (first round, human closed without commenting)

### CLI→UI Interface

The CLI communicates with UI adapters via environment variables:

- `SPECTRAL_FILE` — absolute path to the spec markdown file
- `SPECTRAL_REVIEW` — absolute path to the review JSON file (read existing threads)
- `SPECTRAL_DRAFT` — absolute path to the draft JSON file (write new threads/messages here)

For the built-in TUI (v1), these are used internally. For external adapters (neovim plugin, v2), they are set as env vars before spawning the process.

### Tech

- Node.js (TypeScript)
- Renders the built-in TUI (v1), spawns neovim (v2), or starts Express server (v2)
- Single entry point, swappable UI backend

## Built-in TUI (v1)

### UX

A terminal pager that renders the spec with line numbers, status indicators, and inline comment hints. No external dependencies — ships with the CLI.

```
┌──────────────────────────────────────────────────────────────┐
│ docs/specs/2026-03-14-feature-design.md             [Review] │
│ Lines: 228  Threads: 3 open, 2 addressed, 1 discussed       │
├──────────────────────────────────────────────────────────────┤
│ 12  The system uses polling...    ✅ changed to polling      │
│ 13  to notify downstream                                     │
│ 14                                                           │
│ 45  Events are sent via webhook   💬 this term is ambiguous  │
│ 46                                   🤖 I think it's clear…  │
│ 47                                                           │
│ 20  The retry logic should        💬 rethink this section    │
│ 21  handle exponential backoff                               │
│ 22  with a maximum of 5 retries                              │
│ 23  before dead-lettering                                    │
├──────────────────────────────────────────────────────────────┤
│ j/k scroll  c comment  e expand  r resolve  R resolve all    │
│ a approve   d delete   l list    n/N next/prev   q quit      │
└──────────────────────────────────────────────────────────────┘

Status indicators:
  ✅ addressed — AI changed the spec
  💬 open — unaddressed human comment
  🤖 discussed — AI responded, awaiting human resolve
  ✔  resolved — human accepted
```

Pressing `e` on a line with a thread expands it inline:

```
┌─ Thread #2 (discussed) ─────────────────────────┐
│ 👤 this term is ambiguous                        │
│                                                  │
│ 🤖 I think it's clear because X. The term       │
│    refers to the webhook delivery mechanism      │
│    defined in section 3.                         │
│                                                  │
│ [r]esolve  [c]ontinue  [q]uit                   │
└──────────────────────────────────────────────────┘
```

On subsequent rounds, the TUI shows a diff header highlighting what the AI changed (lines added/removed/modified since the last review), so the human doesn't need to re-read the whole spec. Changed lines are highlighted in the pager.

### Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` / `↑` / `↓` | Scroll line by line |
| `Space` / `b` | Page down / up |
| `c` | Add comment on current line / reply to existing thread |
| `e` | Expand thread on current line |
| `r` | Resolve thread on current line |
| `R` | Resolve all `discussed` threads (batch resolve) |
| `a` | Approve spec — all threads must be resolved/addressed/outdated first |
| `d` | Delete own draft comment on current line |
| `l` | List all open threads (jump to selected) |
| `n` / `N` | Jump to next / previous open thread |
| `q` | Quit and submit review |

### Approve Mechanism

When the human presses `a`:

1. TUI checks all threads are `addressed`, `resolved`, or `outdated`. If not, shows an error ("N threads still open/discussed").
2. TUI writes `{ "approved": true }` to `$SPECTRAL_DRAFT` and exits.
3. CLI reads the draft, detects the `approved` flag, prints `APPROVED: <review-file-path>` to stdout.

### Diff Highlighting

On subsequent rounds (when a `.review.json` exists with AI responses), the TUI highlights lines that changed since the last review:

- Changed lines are computed from `git diff HEAD~1 -- <spec-file>`
- Added lines shown with `+` gutter marker
- Modified lines shown with `~` gutter marker
- First round (no git history): no diff markers

### Implementation

- Built into the CLI (Node.js/TypeScript)
- Uses a terminal UI library (e.g., `ink`, `blessed`, or raw ANSI escape codes)
- Reads `$SPECTRAL_REVIEW` if it exists (missing file = first review, start fresh), loads existing threads
- Checks `$SPECTRAL_DRAFT` for in-progress comments (resume)
- On `q` — writes draft JSON to `$SPECTRAL_DRAFT` (CLI handles merge to review file)
- On save (auto, periodic) — writes draft JSON for crash recovery

### Comment Input

When the user presses `c`:

- **On a line with no thread:** opens an inline text input below the current line. A new thread `id` is assigned.
- **On a line with an existing thread:** expands the thread first, opens a reply input at the bottom.

`Enter` submits single-line comments. For multi-line, `Enter` adds a newline, `Ctrl+D` submits. `Escape` cancels.

### Comment Rendering

Messages are stored as markdown in the JSON. The TUI renders markdown as plain text with basic formatting (bold, italic, code blocks) using ANSI escape codes. Full markdown rendering is available in the thread expand view.

## Review Lifecycle

```
1. Claude Code generates spec → spec.md, commits it
2. Claude Code runs: spectral spec.md
3. CLI checks for draft → resumes or starts fresh
4. TUI opens (first round: plain view; subsequent rounds: diff-highlighted view showing AI changes)
5. Human reads, adds comments, resolves addressed threads
6. Periodic auto-save → TUI writes .review.draft.json (crash recovery)
7. On q (quit) → TUI writes final draft, CLI merges draft into .review.json, exits
8. Claude Code reads .review.json, processes open threads (updates spec or responds),
   rewrites .review.json with updated anchors/statuses/responses, commits spec changes
9. Claude Code runs spectral again → human sees diff of AI changes + AI responses
10. Human resolves threads, or continues discussion
11. When all threads clear → human presses a (approve)
12. CLI exits with "APPROVED: path/to/review.json" on stdout → Claude Code proceeds to implementation plan
```

### Crash Recovery

If the TUI crashes or is killed, the draft file persists. Next invocation of `spectral` detects the draft and resumes with all previous comments loaded.

## Claude Code Integration

A `/review-spectral` skill wraps the `spectral` CLI. The skill:

1. Runs `spectral <spec-file>` (blocks while human reviews)
2. Reads stdout — if `APPROVED:`, proceeds to implementation plan
3. If a review file path is returned, reads the JSON, processes each thread:
   - `open` threads: update spec or respond with explanation
   - `discussed` threads with new human replies: re-evaluate
   - `discussed` threads with no human action: prompt the user about them before next spectral invocation
4. Commits spec changes, rewrites `.review.json` with updated anchors/statuses/responses
5. Loops back to step 1 (runs `spectral` again)
6. On `APPROVED:`, invokes the writing-plans skill

## V2 Scope (not built in v1)

- **Neovim plugin** — Lua plugin using extmarks for comment overlays, floating windows for thread expansion, built-in diff mode for split-view review. Power-user adapter for those already in neovim. Inspired by [reviewthem.nvim](https://github.com/KEY60228/reviewthem.nvim).
- **Web UI** — Express server + React frontend, difit-inspired. Markdown rendered with line numbers, click/drag to comment, submit button finalizes.
- **Touch/region gestures** — circle-to-select on iPad, translated to region anchors by the UI.
- **History navigation** — view previous review states via git history for context.

## V3 Scope (not built in v1 or v2)

- **Google Docs integration** — Use Google Docs as the review UI. Upload the spec as a Google Doc (markdown import), human reviews using native Google Docs commenting, pull comments back via API and map to our JSON protocol.
- **[gws CLI](https://github.com/googleworkspace/cli)** — Rust CLI for Google Workspace APIs with structured JSON output, MCP server mode, and full Docs API access. Handles doc creation, comment retrieval, and markdown import/export. Designed for AI agent workflows.
- **Flow:** `spectral spec.md --gdocs` → upload via `gws` → open doc URL → human adds native Google Docs comments → signal done → pull comments via `gws` → map to JSON protocol → merge into `.review.json`

## Future Considerations

- **Multi-reviewer support** — v1 is one human, one AI, one JSON file. Supporting multiple concurrent reviewers would require a database (e.g., CouchDB) for concurrency, conflict resolution, and real-time sync. This is a fundamentally different product — a collaboration platform, not a review tool. Deferred indefinitely.

## Inspirations

- **[difit](https://github.com/yoshiko-pg/difit)** — CLI that spins up a web server for reviewing git diffs with comments. Validated the "CLI → local server → browser → structured output on close" pattern.
- **[reviewthem.nvim](https://github.com/KEY60228/reviewthem.nvim)** — Neovim plugin for adding review comments with gutter signs and JSON export.

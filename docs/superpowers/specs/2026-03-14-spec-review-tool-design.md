# Spectral — Design

A review tool for AI-generated spec documents. Unlike traditional spec review (human reviews, human author edits), the author here is an AI — it reads structured feedback and acts on every comment instantly. This enables multiple review rounds in a single sitting, with the human's only job being to give feedback.

## Problem

In AI-assisted development (e.g., Claude Code's superpowers workflow), the AI generates spec documents that need human review before implementation. The current review step breaks the agentic loop — the user has to open the markdown file separately, read it, then type unstructured feedback in the terminal. There's no way to attach comments inline, highlight regions, or give feedback the AI can precisely act on.

Traditional review tools (Google Docs, PR reviews) are designed for human-to-human workflows. They optimize for discussion, consensus, and collaborative editing. But when the spec author is an AI, the workflow is fundamentally different: the human only comments, the AI always edits, and turnaround is instant.

## Solution

A CLI tool (`spectral`) that opens a spec file in a reviewable UI, lets the user add line-anchored comments, and outputs structured JSON on close. The AI reads the JSON, addresses each comment, updates the spec, and re-invokes the review tool — completing the human-AI feedback loop in seconds rather than days.

## Architecture

```
┌─────────────────────────────────────────┐
│  Protocol: JSON schema (language-agnostic) │
├─────────────────────────────────────────┤
│  CLI: spectral <file> [--nvim|--web]    │
├──────────────┬──────────────────────────┤
│  Neovim Plugin│  Web UI                 │
│  (Lua)        │  (React/Express)        │
│  v1           │  v2                     │
└──────────────┴──────────────────────────┘
```

Three layers:

- **Protocol** — A JSON schema defining review comments. Language-agnostic. Any UI that outputs this format works with Claude Code.
- **CLI** — Node-based entry point. Manages file lifecycle (draft/final/resume/cleanup), spawns the chosen UI, blocks until review is done, prints the output path.
- **UI Adapters** — Neovim plugin (v1), web UI (v2), future touch/iPad client. Each reads the spec + existing review threads, lets the user add messages, appends to the JSONL.

## Protocol

### Review File Format (JSONL)

The review file is append-only JSONL. Each line is a message in a thread. Both the human UI and the AI append lines — no parsing or rewriting the whole file.

```jsonl
{"id":"1","line":12,"author":"human","text":"why webhook not polling?"}
{"id":"1","author":"ai","text":"Changed to polling. Good call.","status":"addressed"}
{"id":"2","line":45,"startChar":10,"endChar":17,"author":"human","text":"this term is ambiguous"}
{"id":"2","author":"ai","text":"I think it's clear because X","status":"discussed"}
{"id":"2","author":"human","text":"no, we need to specify Y and Z","status":"open"}
{"id":"3","startLine":20,"startChar":0,"endLine":28,"endChar":40,"author":"human","text":"this whole section needs rethinking"}
{"id":"4","quotedText":"The webhook system should handle retry logic","author":"human","text":"can we use polling instead?"}
```

**Thread model:** Messages with the same `id` form a thread. Ordering is line position in the file (append-only). The latest `status` for a given `id` is the current thread status.

### Thread Statuses

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `open` | Unaddressed (default on creation, or human reopens) | Human |
| `addressed` | AI changed the spec for this | AI |
| `discussed` | AI responded without changing | AI |
| `resolved` | Human accepts, done | Human |

The review is complete when every thread is either `addressed` or `resolved`. Threads in `discussed` state require human action — the human must either `resolve` (accept the AI's explanation) or reply to reopen as `open`. Claude Code should prompt the user about any remaining `discussed` threads.

### Anchor Types

| Type | Fields | Source | Use Case |
|------|--------|--------|----------|
| Line | `line` | Neovim, Web | Comment on a whole line |
| Span | `line`, `startChar`, `endChar` | Neovim, Web | Highlight characters within a line |
| Region | `startLine`, `startChar`, `endLine`, `endChar` | Web (drag), Touch | Multi-line selection |
| Quoted | `quotedText` | Google Docs, any UI without line resolution | Text-anchored comment |

Anchor fields only appear on the first message of a thread (the root). Replies inherit the anchor from the root. All four strategies use consistent field naming. `quotedText` can appear alongside a positional anchor for redundancy.

### Message Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Thread identifier (all messages with same `id` form a thread) |
| `author` | string | yes | `"human"` or `"ai"` |
| `text` | string (markdown) | yes | The message body |
| `status` | string | no | Thread status change: `open`, `addressed`, `discussed`, `resolved` |
| `line` | integer (1-indexed) | anchor (root only) | Line number for line or span comments |
| `startChar` | integer (0-indexed) | no | Start character offset |
| `endChar` | integer (0-indexed) | no | End character offset (exclusive) |
| `startLine` | integer (1-indexed) | anchor (root only) | Start line for region comments |
| `endLine` | integer (1-indexed) | anchor (root only) | End line for region comments (inclusive) |
| `quotedText` | string | anchor (root only) | Text-anchored comment |

**Anchor rules:** The root message (first with a given `id`) must have at least one anchor: a positional anchor (`line`, `startLine`/`endLine`), a `quotedText` anchor, or both. `line` and `startLine`/`endLine` are mutually exclusive — use `line` for single-line anchors (with optional `startChar`/`endChar` for span), use `startLine`/`endLine` for multi-line regions. For span anchors, both `startChar` and `endChar` must be present.

### File Naming

Review file lives next to the spec (single file, both sides append):

```
docs/specs/2026-03-14-feature-design.md
docs/specs/2026-03-14-feature-design.review.jsonl          # the review
docs/specs/2026-03-14-feature-design.review.draft.jsonl    # in-progress (human hasn't submitted yet)
```

No round numbers — the file is a living conversation. Git tracks history.

The review file (`.review.jsonl`) is append-only — neither the UI nor the AI ever rewrites it. The draft file (`.review.draft.jsonl`) is mutable — the plugin may rewrite it (e.g., on delete). Only the CLI merges the draft into the review file.

### Thread ID Generation

Simple incrementing strings: `"1"`, `"2"`, `"3"`, etc. The UI reads the highest existing `id` in the review + draft files and increments. The AI does the same when creating new threads. No collision risk — only one writer at a time (see Concurrency below).

### Concurrency

The JSONL file has a single-writer contract. The human UI and the AI never write concurrently — the workflow alternates: human reviews (CLI blocks) → CLI merges draft → AI reads and appends → AI invokes CLI again → human reviews. If this assumption is violated, the file may be corrupted.

## CLI

### Usage

```bash
spectral <file.md>          # opens with default UI (neovim)
spectral <file.md> --nvim   # explicit neovim
spectral <file.md> --web    # web UI (v2)
```

### Responsibilities

1. Validate the spec file exists and is readable; exit 1 with error message if not
2. Check for `.review.draft.jsonl` — if exists, validate it's parseable JSONL. If corrupted, warn the user ("Draft file corrupted, starting fresh") and delete it. If valid, pass to UI for resume
3. Open the chosen UI, passing: spec file path, review file path, draft file path (see CLI→Plugin Interface below)
4. Block until the UI exits
5. If the draft contains messages, append its contents to `.review.jsonl` and delete the draft. If the draft is empty, delete it.
6. Print the review file path to stdout and exit 0. Always print the path if a `.review.jsonl` exists (even if no new comments this round — there may be `discussed` threads needing attention). Print nothing only if no review file exists at all (first round, human closed without commenting)

### CLI→Plugin Interface

The CLI communicates with the neovim plugin via environment variables set before spawning neovim:

- `SPECTRAL_FILE` — absolute path to the spec markdown file
- `SPECTRAL_REVIEW` — absolute path to the review JSONL file (read existing threads)
- `SPECTRAL_DRAFT` — absolute path to the draft JSONL file (append new messages here)

```bash
SPECTRAL_FILE=/path/to/spec.md \
SPECTRAL_REVIEW=/path/to/spec.review.jsonl \
SPECTRAL_DRAFT=/path/to/spec.review.draft.jsonl \
nvim -c "lua require('spectral').start()" /path/to/spec.md
```

### Tech

- Node.js (TypeScript)
- Spawns neovim as a child process (v1), starts Express server (v2)
- Single entry point, swappable UI backend

## Neovim Plugin (v1)

### UX

The plugin opens the spec file in a read-only buffer with an overlay comment system using neovim extmarks (virtual text).

```
┌──────────────────────────────────────────────────────────────┐
│ docs/specs/2026-03-14-feature-design.md             [Review] │
├──────────────────────────────────────────────────────────────┤
│ 12  The system uses polling...    ✅ changed to polling      │
│ 13  to notify downstream                                     │
│ 14                                                           │
│ 45  Events are sent via webhook   💬 this term is ambiguous  │
│ 46                                   🤖 I think it's clear…  │
│ 47                                                           │
│ 20  ┃ The retry logic should      💬 rethink this section    │
│ 21  ┃ handle exponential backoff                             │
│ 22  ┃ with a maximum of 5 retries                            │
│ 23  ┃ before dead-lettering                                  │
└──────────────────────────────────────────────────────────────┘

Status indicators:
  ✅ addressed — AI changed the spec
  💬 open — unaddressed human comment
  🤖 discussed — AI responded, awaiting human resolve
  ✔  resolved — human accepted
```

The expand view (`<leader>me`) shows the full thread in a floating window:

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

### Keybindings (configurable)

| Key | Mode | Action |
|-----|------|--------|
| `<leader>mc` | Normal | Add comment on current line / reply to existing thread |
| `<leader>mc` | Visual | Add comment on selected region |
| `<leader>me` | Normal | Expand thread under cursor (full markdown, actions) |
| `<leader>mr` | Normal | Resolve thread under cursor |
| `<leader>md` | Normal | Delete own draft message under cursor (rewrites draft file; only works on unsubmitted messages, not on the review file) |
| `<leader>ml` | Normal | List all open threads (quickfix) |
| `]c` | Normal | Jump to next open thread |
| `[c` | Normal | Jump to previous open thread |

### Implementation

- Pure Lua, no dependencies beyond neovim
- Comments stored as buffer-local data, rendered via extmarks (`virt_text_pos = 'eol'`) in a dedicated namespace
- Gutter signs for lines with comments, sign column markers for regions
- On open — plugin reads `$SPECTRAL_REVIEW` if it exists (missing file = first review, start fresh), loads existing threads including AI responses. Checks `$SPECTRAL_DRAFT` for in-progress human comments (resume)
- On `:w` — plugin flushes any unsaved messages to `$SPECTRAL_DRAFT` (tracks what's already been written to avoid duplicates)
- On `:q` / `VimLeave` — plugin flushes remaining unsaved messages to `$SPECTRAL_DRAFT` (CLI handles merge to review file)

### Comment Input

When the user triggers `<leader>mc`:

- **On a line with no thread:** opens a floating window to create a new comment. A new thread `id` is assigned.
- **On a line with an existing thread:** opens the expand view first (showing the thread), with the cursor in a reply input. The reply is appended to that thread.

Multi-line messages are supported — `<leader><Enter>` submits, `Escape` cancels. (Avoids `<C-Enter>` which is unreliable across terminal emulators.) The message immediately appears as virtual text on the anchored line (first line shown as plain text, truncated).

### Comment Rendering

Messages are stored as markdown in the JSONL. Neovim cannot render markdown in virtual text (extmarks are plain text only), so:

- **Inline hint** (eol virtual text) — plain text, first line only, truncated
- **Expand view** (`<leader>me`) — opens a floating window with full markdown rendered via `vim.lsp.util.stylize_markdown()` (built-in neovim LSP utility)
- **Web UI (v2)** — markdown rendered natively everywhere

## Review Lifecycle

```
1. Claude Code generates spec → spec.md
2. Claude Code runs: spectral spec.md
3. CLI checks for draft → resumes or starts fresh
4. Neovim opens with review plugin loaded, showing existing threads + AI responses
5. Human reads, adds comments, resolves addressed threads
6. On :w → plugin appends new messages to .review.draft.jsonl (incremental save)
7. On :q → CLI merges draft into .review.jsonl, exits
8. Claude Code reads JSONL, processes open threads (updates spec or responds), appends to .review.jsonl
9. Claude Code runs spectral again → human sees AI responses, continues or resolves
10. Done when all threads are addressed or resolved
```

### Crash Recovery

If neovim crashes or is killed, the draft file persists. Next invocation of `spectral` detects the draft and resumes with all previous messages loaded.

## V2 Scope (not built in v1)

- **Web UI** — Express server + React frontend, difit-inspired. Markdown rendered with line numbers, click/drag to comment, submit button finalizes.
- **Touch/region gestures** — circle-to-select on iPad, translated to region anchors by the UI.
- **Round navigation** — view previous review rounds in the UI for context.
- **Claude Code skill integration** — a `/review` skill that automates the spectral invocation.

## V3 Scope (not built in v1 or v2)

- **Google Docs integration** — Use Google Docs as the review UI. Upload the spec as a Google Doc (markdown import), human reviews using native Google Docs commenting, pull comments back via API and map to our JSON protocol.
- **[gws CLI](https://github.com/googleworkspace/cli)** — Rust CLI for Google Workspace APIs with structured JSON output, MCP server mode, and full Docs API access. Handles doc creation, comment retrieval, and markdown import/export. Designed for AI agent workflows.
- **Flow:** `spectral spec.md --gdocs` → upload via `gws` → open doc URL → human adds native Google Docs comments → signal done → pull comments via `gws` → map to JSON protocol → write `.review-N.json`

## Future Considerations

- **Multi-reviewer support** — v1 is one human, one AI, one JSONL file. Supporting multiple concurrent reviewers would require a database (e.g., CouchDB) for concurrency, conflict resolution, and real-time sync. This is a fundamentally different product — a collaboration platform, not a review tool. Deferred indefinitely.

## Inspirations

- **[difit](https://github.com/yoshiko-pg/difit)** — CLI that spins up a web server for reviewing git diffs with comments. Validated the "CLI → local server → browser → structured output on close" pattern.
- **[reviewthem.nvim](https://github.com/KEY60228/reviewthem.nvim)** — Neovim plugin for adding review comments with gutter signs and JSON export.

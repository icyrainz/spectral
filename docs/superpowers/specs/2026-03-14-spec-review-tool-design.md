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
- **UI Adapters** — Neovim plugin (v1), web UI (v2), future touch/iPad client. Each reads the spec, lets the user comment, writes the JSON.

## Protocol

### Review JSON Schema

```json
{
  "file": "docs/specs/2026-03-14-feature-design.md",
  "comments": [
    {
      "line": 12,
      "text": "what about error handling here?"
    },
    {
      "line": 45,
      "startChar": 10,
      "endChar": 17,
      "text": "can we use polling instead?"
    },
    {
      "startLine": 20,
      "startChar": 0,
      "endLine": 28,
      "endChar": 40,
      "text": "this whole section needs rethinking"
    },
    {
      "quotedText": "The webhook system should handle retry logic",
      "text": "can we use polling instead?"
    }
  ]
}
```

### Anchor Types

| Type | Fields | Source | Use Case |
|------|--------|--------|----------|
| Line | `line` | Neovim, Web | Comment on a whole line |
| Span | `line`, `startChar`, `endChar` | Neovim, Web | Highlight characters within a line |
| Region | `startLine`, `startChar`, `endLine`, `endChar` | Web (drag), Touch | Multi-line selection |
| Quoted | `quotedText` | Google Docs, any UI without line resolution | Text-anchored comment |

All four are anchor strategies, using consistent field naming (`startChar`/`endChar` everywhere). A line comment is the simplest form; a span adds character offsets within that line; a region spans multiple lines. UIs use whichever they can resolve — neovim v1 supports line and span, web v2 adds region, Google Docs v3 uses quoted text. Any comment can optionally include `quotedText` alongside a positional anchor for redundancy — Claude Code can fuzzy-match quoted text to the right location when line numbers aren't available or have drifted.

The round number is encoded in the filename (`.review-N.json`), not in the JSON body — single source of truth.

### Comment Field Reference

Every comment object requires a `text` field (the comment body) and at least one anchor:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | yes | The comment body |
| `line` | integer (1-indexed) | anchor | Line number for line or span comments |
| `startChar` | integer (0-indexed) | no | Start character offset within a line (span) or start line (region) |
| `endChar` | integer (0-indexed) | no | End character offset (exclusive) |
| `startLine` | integer (1-indexed) | anchor | Start line for region comments |
| `endLine` | integer (1-indexed) | anchor | End line for region comments (inclusive) |
| `quotedText` | string | anchor | The highlighted text content for text-anchored comments |

**Anchor rules:** A comment must have exactly one anchor strategy: `line` (with optional `startChar`/`endChar` for span), `startLine`/`endLine` (region), or `quotedText`. For span anchors, both `startChar` and `endChar` must be present — partial spans (one without the other) are invalid. `quotedText` can additionally appear alongside any positional anchor as supplementary context.

### File Naming

Review files live next to the spec:

```
docs/specs/2026-03-14-feature-design.md
docs/specs/2026-03-14-feature-design.review-1.json        # round 1 (final)
docs/specs/2026-03-14-feature-design.review-1.draft.json   # round 1 (in progress)
docs/specs/2026-03-14-feature-design.review-2.json        # round 2 (final)
```

## CLI

### Usage

```bash
spectral <file.md>          # opens with default UI (neovim)
spectral <file.md> --nvim   # explicit neovim
spectral <file.md> --web    # web UI (v2)
```

### Responsibilities

1. Validate the spec file exists and is readable; exit 1 with error message if not
2. Determine the next review round number (scan for existing `.review-N.json` files)
3. Check for `.review-N.draft.json` — if exists, validate it's parseable JSON. If corrupted, warn the user ("Draft file corrupted, starting fresh") and delete it. If valid, pass to UI for resume
4. Open the chosen UI, passing: spec file path, draft file path, round number (see CLI→Plugin Interface below)
5. Block until the UI exits
6. If the draft contains comments, rename `.review-N.draft.json` to `.review-N.json` (atomic move). If the draft has no comments (empty array), delete the draft file.
7. Print the final JSON path to stdout and exit 0. If no comments were added (draft was deleted), print nothing to stdout and exit 0 — Claude Code treats empty stdout as "no feedback"

### CLI→Plugin Interface

The CLI communicates with the neovim plugin via environment variables set before spawning neovim:

- `SPECTRAL_FILE` — absolute path to the spec markdown file
- `SPECTRAL_DRAFT` — absolute path to the draft JSON file (write here on save)
- `SPECTRAL_ROUND` — round number (integer)

The plugin reads these on startup. The CLI spawns neovim as:

```bash
SPECTRAL_FILE=/path/to/spec.md \
SPECTRAL_DRAFT=/path/to/spec.review-1.draft.json \
SPECTRAL_ROUND=1 \
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
┌─────────────────────────────────────────────────────┐
│ docs/specs/2026-03-14-feature-design.md    [Review] │
├─────────────────────────────────────────────────────┤
│ 12  The system uses a webhook...  💬 what about...  │
│ 45  Events are sent via webhook   💬 use polling?   │
│ 20  ┃ The retry logic should      💬 rethink this   │
│ 21  ┃ handle exponential backoff     whole section   │
│ 22  ┃ with a maximum of 5 retries                   │
│ 23  ┃ before dead-lettering                         │
└─────────────────────────────────────────────────────┘
```

### Keybindings (configurable)

| Key | Mode | Action |
|-----|------|--------|
| `<leader>mc` | Normal | Add comment on current line |
| `<leader>mc` | Visual | Add comment on selected region |
| `<leader>md` | Normal | Delete comment under cursor |
| `<leader>ml` | Normal | List all comments (quickfix) |
| `]c` | Normal | Jump to next comment |
| `[c` | Normal | Jump to previous comment |

### Implementation

- Pure Lua, no dependencies beyond neovim
- Comments stored as buffer-local data, rendered via extmarks (`virt_text_pos = 'eol'`) in a dedicated namespace
- Gutter signs for lines with comments, sign column markers for regions
- On `:w` — plugin writes draft JSON to `$SPECTRAL_DRAFT`
- On `:q` / `VimLeave` — plugin writes draft JSON to `$SPECTRAL_DRAFT` (CLI handles atomic rename to final)
- On open — plugin checks if `$SPECTRAL_DRAFT` exists, loads comments from it (resume)

### Comment Input

When the user triggers `<leader>mc`, a floating window opens for typing the comment. Multi-line comments are supported — `<leader><Enter>` submits, `Escape` cancels. (Avoids `<C-Enter>` which is unreliable across terminal emulators.) The comment immediately appears as virtual text on the anchored line (first line of comment shown, truncated if multi-line).

## Review Lifecycle

```
1. Claude Code generates spec → spec.md
2. Claude Code runs: spectral spec.md
3. CLI checks for draft → resumes or starts fresh
4. Neovim opens with review plugin loaded
5. Human reads, adds comments
6. On :w → plugin writes .review-N.draft.json (incremental save)
7. On :q → plugin writes final draft, CLI renames draft to .review-N.json, exits
8. Claude Code reads JSON, addresses each comment, updates spec
9. Repeat from step 2 for next round
```

### Crash Recovery

If neovim crashes or is killed, the draft file persists. Next invocation of `spectral` detects the draft and resumes with all previous comments loaded.

## V2 Scope (not built in v1)

- **Web UI** — Express server + React frontend, difit-inspired. Markdown rendered with line numbers, click/drag to comment, submit button finalizes.
- **Touch/region gestures** — circle-to-select on iPad, translated to region anchors by the UI.
- **Round navigation** — view previous review rounds in the UI for context.
- **Claude Code skill integration** — a `/review` skill that automates the spectral invocation.

## V3 Scope (not built in v1 or v2)

- **Google Docs integration** — Use Google Docs as the review UI. Upload the spec as a Google Doc (markdown import), human reviews using native Google Docs commenting, pull comments back via API and map to our JSON protocol.
- **[gws CLI](https://github.com/googleworkspace/cli)** — Rust CLI for Google Workspace APIs with structured JSON output, MCP server mode, and full Docs API access. Handles doc creation, comment retrieval, and markdown import/export. Designed for AI agent workflows.
- **Flow:** `spectral spec.md --gdocs` → upload via `gws` → open doc URL → human adds native Google Docs comments → signal done → pull comments via `gws` → map to JSON protocol → write `.review-N.json`

## Inspirations

- **[difit](https://github.com/yoshiko-pg/difit)** — CLI that spins up a web server for reviewing git diffs with comments. Validated the "CLI → local server → browser → structured output on close" pattern.
- **[reviewthem.nvim](https://github.com/KEY60228/reviewthem.nvim)** — Neovim plugin for adding review comments with gutter signs and JSON export.

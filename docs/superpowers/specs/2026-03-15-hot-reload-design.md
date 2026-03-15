# Hot-Reload: In-Place Spec Rewrite with Submit/Approve

## Problem

The current revspec loop requires the reviewer to quit the TUI after each round of feedback. The AI rewrites the spec externally, then relaunches revspec. This loses scroll position and review context, creating friction in multi-round reviews.

## Solution

Add two new keybindings that let the reviewer stay in the TUI across rewrite rounds:

- **`S` (Shift+S)** — Submit for rewrite. The AI rewrites the spec; the TUI reloads in-place.
- **`A` (Shift+A)** — Approve. Spec is finalized; TUI exits. Replaces the old `a` binding.

Both require all threads resolved before proceeding.

## Keybinding Changes

| Old | New | Action |
|-----|-----|--------|
| `a` | `A` | Approve spec (destructive — exits TUI) |
| — | `S` | Submit for rewrite (stay in TUI) |
| `R` | `R` | Resolve all pending (unchanged) |

Remove the lowercase `a` binding entirely.

## Unresolved Threads Gate

Both `S` and `A` share the same gate:

1. Check if any threads are unresolved (open or pending)
2. If unresolved → show confirm popup: "N unresolved thread(s). Resolve all and continue? [y/n]"
   - `y` → resolve all threads, proceed with submit/approve
   - `n` → return to pager
3. If all resolved → proceed directly

## Submit Flow (`S`)

1. All threads resolved (via gate above)
2. Show blocking popup with spinner: "Submitting to agent to update spec..."
3. Emit `{"type":"submit","author":"reviewer","ts":...}` event to JSONL
4. TUI polls `specMtime` — when the file changes:
   - Re-read `spec.md` into `state.specLines`
   - Clear all threads from state
   - Reset cursor to line 1
   - Keep JSONL intact (full history for final merge on approve)
   - Update `lastMergedOffset` to current JSONL size
   - Dismiss spinner popup
   - Refresh pager — human continues reviewing the new version
5. 120s timeout — if spec doesn't change, dismiss spinner with warning. Reviewer can retry with S. Ctrl+C cancels immediately.

## Approve Flow (`A`)

1. All threads resolved (via gate above)
2. Emit `{"type":"approve","author":"reviewer","ts":...}` event to JSONL
3. Exit TUI (no merge — JSONL is the single source of truth)

## New JSONL Event

```jsonl
{"type":"submit","author":"reviewer","ts":1710400000}
```

The `submit` event signals: "I've resolved all threads. Rewrite the spec incorporating the feedback, then I'll review the next version."

Distinct from `approve` which means: "Spec is finalized, proceed to implementation."

## Watch Process Changes

`revspec watch` needs to handle `submit` as a third exit condition:

| Event | Watch behavior |
|-------|----------------|
| `approve` | Print "Review approved." and exit with code 0 |
| `session-end` | Print "Session ended." and exit with code 0 |
| `submit` | Print resolved thread summaries and exit with code 0 |

The watch output for `submit` includes only the **current round's** resolved threads (events after the last prior `submit` delimiter):

```
=== Submit: Rewrite Requested ===

Resolved threads:
  t1 (line 14): "this is unclear" → AI: "I'll clarify the polling vs webhook distinction."
  t3 (line 42): "should use a queue" → AI: "Agreed, switching to queue-based approach."

Rewrite the spec incorporating the above, then run: revspec watch spec.md
```

### Crash Recovery

If the AI crashes after `submit` is emitted but before the spec is rewritten, the next `revspec watch` detects the pending submit (a `submit` event with no new reviewer activity after it) and re-outputs the same resolved thread summary. The AI must verify whether the spec already reflects the feedback before rewriting — do not blindly rewrite.

### Round Boundaries

The `submit` event acts as a round delimiter in the JSONL. Watch only surfaces threads from the current round (events after the last prior `submit`). The full JSONL is preserved as an audit log.

## Skill File Changes

The `/revspec` skill's Step 4 needs a third case:

### Submit (reviewer pressed `S`)

Watch returns resolved thread summaries from the current round.

1. Read the current spec and compare against the resolved threads
2. If changes needed: rewrite the spec and save (triggers TUI reload)
3. If spec already reflects feedback (crash recovery): skip rewrite
4. Run `revspec watch` again — the reviewer is still in the TUI

The loop becomes:
```
1. Launch revspec on spec file
2. Watch for comments
3. Reply to each comment
4. Watch again (repeat 2-3 until submit/session-end/approval)
5. On submit: verify and rewrite spec if needed (triggers TUI reload), go to step 2
6. On session-end: stop, user will invoke /revspec again if needed
7. On approval: spec is finalized, done
```

## UI Components

### Spinner Popup

A modal dialog (like the confirm popup) centered on screen:
- Title: "Submitting"
- Message: "Waiting for agent to update spec..."
- Spinner animation: rotating `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille dots)
- Ctrl+C cancels and returns to pager
- 120s timeout — dismisses with "Agent did not update spec" message, reviewer can retry with S

### Resolve-All Confirm Popup

Reuses the existing `createConfirm` dialog:
- Title: "Unresolved Threads"
- Message: "N thread(s) still unresolved. Resolve all and continue?"
- `y` → resolve all, proceed
- `n` → cancel, return to pager

## Files to Modify

- `src/tui/app.ts` — new `S`/`A` bindings, handlers, resolve-all gate, spinner popup, spec reload
- `src/tui/help.ts` — update keybinding reference
- `src/tui/status-bar.ts` — (optional) hint for `S`/`A`
- `src/cli/watch.ts` — handle `submit` event type
- `src/protocol/types.ts` — add `submit` event type if typed
- `skills/revspec/SKILL.md` — add submit case to the loop
- `README.md` — update keybindings table
- `test/` — unit tests for submit event, reload logic

## What We're NOT Doing

- No line remapping — threads are cleared on reload (clean slate per round)
- No merge on submit — only on approve
- No comment editing — once submitted, it's in the pipeline
- No diff view between rounds — human reviews the full new spec

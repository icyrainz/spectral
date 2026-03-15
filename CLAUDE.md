# Revspec

- Tech: Bun + TypeScript + @opentui/core
- npm: `revspec` | GitHub: icyrainz/revspec
- Run: `bun run bin/revspec.ts <file.md>`
- Test: `bun run test` (~3s, unit + integration)
- E2E: `bun run test:e2e` (~7s, bun-pty snapshots — only run before release, update with `--update-snapshots`)
- All: `bun run test:all` (everything)
- Release: `./scripts/release.sh` (version is set manually in package.json)
- Dev: `bun link` to symlink local build to global `revspec` command

## OpenTUI Gotchas
- Don't use StyledText at all — BigInt FFI crash happens even on small content
- Don't use ANSI escape codes in TextRenderable content (renders as literal text)
- MarkdownRenderable needs `syntaxStyle` + `conceal: true` for proper rendering
- Use `visible: false` to hide renderables, not removal/re-addition
- ScrollBox: don't use `stickyScroll` with manual scrolling (fights scroll position)
- ScrollBox: `scrollBy` overshoots silently on large deltas — use `scrollTo` with clamped position
- Textarea consumes Ctrl+D/U (emacs bindings) — blur textarea in normal mode for vim-style scroll
- SelectRenderable focus is unreliable — use manual key handlers for j/k/Enter instead of relying on focus

## Conventions
- Tab to submit in all text inputs (works through tmux)
- Destructive actions need confirmation (dd double-tap, approve confirm dialog)
- Thread popup uses vim-style normal/insert modes (blur textarea in normal)
- Hint bars use `[key] action` bracket format — all labels defined in `src/tui/ui/keymap.ts`
- Consistent dismiss/confirm keys: `y/Enter` to confirm, `q/Esc` to dismiss (all popups)
- No inline comment previews in pager — gutter indicators only (▌/█/✓)
- Thread IDs use nanoid (8-char alphanumeric) — no sequential t1/t2
- No review JSON — JSONL is the single source of truth
- `submit` events in JSONL act as round delimiters
- S submits for rewrite (stays in TUI), A approves (exits)
- `:q` warns if unresolved threads, `:q!` force quits

## Live Protocol
- JSONL file (`spec.review.jsonl`) — append-only, both TUI and AI write to it
- `revspec watch` / `revspec reply` CLI subcommands for AI integration
- Watch handles three exit conditions: approve > submit > session-end (priority order)
- Crash recovery: watch detects pending unprocessed `submit` and re-outputs resolved thread summaries
- On submit: TUI shows spinner, polls spec mtime, reloads on change, clears threads

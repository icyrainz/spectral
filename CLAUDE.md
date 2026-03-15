# Revspec

- Tech: Bun + TypeScript + @opentui/core
- npm: `revspec` | GitHub: icyrainz/revspec
- Run: `bun run bin/revspec.ts <file.md>`
- Test: `bun run test` (~3s, excludes E2E)
- E2E: `bun run test:e2e` (~25s, bun-pty snapshots — only run before release, update with `--update-snapshots`)
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

## Conventions
- Line mode is default, markdown mode via `m` toggle
- Tab to submit in all text inputs (works through tmux)
- Destructive actions need confirmation (dd double-tap, approve confirm dialog)
- All review actions auto-switch to line mode
- Thread popup uses vim-style normal/insert modes (blur textarea in normal)
- Hint bars use `[key] action` bracket format consistently
- No inline comment previews in pager — gutter indicators only (▌/█/✓)
- Live integration: JSONL for communication, `revspec watch`/`reply` CLI subcommands

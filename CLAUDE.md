# Revspec

- Tech: Bun + TypeScript + @opentui/core
- npm: `revspec` | GitHub: icyrainz/revspec
- Run: `bun run bin/revspec.ts <file.md>`
- Test: `bun test`
- Release: `./scripts/release.sh [patch|minor|major]`

## OpenTUI Gotchas
- Don't use StyledText for large content (BigInt FFI crash)
- Don't use ANSI escape codes in TextRenderable content (renders as literal text)
- MarkdownRenderable needs `syntaxStyle` + `conceal: true` for proper rendering
- Use `visible: false` to hide renderables, not removal/re-addition

## Conventions
- Line mode is default, markdown mode via `m` toggle
- Tab to submit in all text inputs (works through tmux)
- Destructive actions need confirmation (dd double-tap, approve confirm dialog)
- All review actions auto-switch to line mode

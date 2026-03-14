# Spectral

A review tool for AI-generated spec documents. Unlike traditional spec review (human reviews, human author edits), the author here is an AI — it reads structured feedback and acts on every comment instantly.

## Why

When an AI generates a spec, the human review step breaks the agentic loop. You have to open the file separately, read it, then type unstructured feedback in the terminal. Spectral closes this loop with a TUI that lets you comment inline and outputs structured JSON the AI can act on immediately.

## Install

Download a binary from [Releases](https://github.com/icyrainz/spectral/releases):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/icyrainz/spectral/releases/latest/download/spectral-darwin-arm64 -o spectral
chmod +x spectral && sudo mv spectral /usr/local/bin/

# macOS (Intel)
curl -L https://github.com/icyrainz/spectral/releases/latest/download/spectral-darwin-x64 -o spectral
chmod +x spectral && sudo mv spectral /usr/local/bin/

# Linux (x64)
curl -L https://github.com/icyrainz/spectral/releases/latest/download/spectral-linux-x64 -o spectral
chmod +x spectral && sudo mv spectral /usr/local/bin/
```

Or run from source with [Bun](https://bun.sh):

```bash
git clone https://github.com/icyrainz/spectral.git
cd spectral && bun install && bun link
```

## Usage

```bash
spectral spec.md
```

Opens a TUI with two modes:

- **Markdown mode** (default) — rendered markdown for reading. `j/k` scrolls.
- **Line mode** (`m`) — line numbers + thread indicators for commenting.

### Keybindings

| Key | Action |
|-----|--------|
| `j/k` | Scroll down/up |
| `gg` / `G` | Go to top / bottom |
| `Ctrl+D/U` | Half page down/up |
| `m` | Toggle markdown / line mode |
| `c` | Comment on line / view thread / reply |
| `r` | Resolve thread (toggle) |
| `R` | Resolve all pending |
| `dd` | Delete draft comment (double-tap) |
| `/` | Search |
| `n/N` | Next/prev search match |
| `]t/[t` | Next/prev thread |
| `l` | List threads |
| `a` | Approve spec |
| `:w` | Save draft |
| `:q` | Quit (blocks if unsaved) |
| `:wq` | Save and quit |
| `:q!` | Quit without saving |
| `?` | Help |

### Comment input

`Tab` submits. `Enter` adds newline. `Esc` cancels.

## Review Protocol

Spectral outputs a `.review.json` file next to the spec:

```json
{
  "file": "spec.md",
  "threads": [
    {
      "id": "1",
      "line": 12,
      "status": "open",
      "messages": [
        { "author": "human", "text": "why webhook not polling?" }
      ]
    }
  ]
}
```

Thread statuses: `open` (needs AI attention), `pending` (AI replied), `resolved`, `outdated`.

The AI reads this JSON, addresses comments, updates the spec, rewrites the review file with updated anchors/statuses, and re-invokes Spectral. The loop continues until the human approves.

## Roadmap

- **v1** (current): Built-in TUI pager
- **v2**: Neovim plugin, web UI, diff highlighting
- **v3**: Google Docs integration

## License

MIT

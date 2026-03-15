# UI Refactor: Adopt OpenCode Patterns

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc UI code with a reusable `ui/` layer borrowed from opencode patterns, refactor keybindings from monolithic switch to registry, rewrite all overlays to use shared dialog factory.

**Architecture:** Create `src/tui/ui/` with theme, dialog, hint-bar, keybinds, and markdown modules. Overlays become thin wrappers around `createDialog()`. App.ts keybinding switch becomes an action map dispatched by a keybind registry. Pager keeps TextNodeRenderable approach but uses extracted markdown parser.

**Tech Stack:** Bun, TypeScript, @opentui/core (BoxRenderable, TextRenderable, TextNodeRenderable, ScrollBoxRenderable, TextareaRenderable, SelectRenderable)

**Reference:** opencode at `~/repo/opencode/packages/opencode/src/cli/cmd/tui/` for patterns

---

## File Structure

**New files:**
- `src/tui/ui/theme.ts` — Expanded semantic theme (replaces `src/tui/theme.ts`)
- `src/tui/ui/dialog.ts` — Universal dialog factory with backdrop, border, hint bar
- `src/tui/ui/hint-bar.ts` — Reusable `[key] action` hint bar builder
- `src/tui/ui/keybinds.ts` — Keybind registry with sequence support (gg, dd, ]t)
- `src/tui/ui/markdown.ts` — Extracted inline markdown parser + table rendering

**Modified files:**
- `src/tui/app.ts` — Use keybind registry + dialog system, remove switch statement
- `src/tui/pager.ts` — Import from ui/markdown and ui/theme instead of local
- `src/tui/status-bar.ts` — Import from ui/theme and ui/hint-bar
- `src/tui/comment-input.ts` — Rewrite using createDialog()
- `src/tui/thread-list.ts` — Rewrite using createDialog()
- `src/tui/help.ts` — Rewrite using createDialog()
- `src/tui/confirm.ts` — Rewrite using createDialog()
- `src/tui/search.ts` — Import from ui/theme (stays as bottom bar, not dialog)

**Deleted files:**
- `src/tui/theme.ts` — Replaced by ui/theme.ts

---

## Chunk 1: UI Primitives

### Task 1: Expanded Theme

**Files:**
- Create: `src/tui/ui/theme.ts`

- [ ] **Step 1: Create ui/theme.ts with semantic color roles**

```typescript
// Catppuccin Mocha base + semantic roles matching opencode patterns
export const theme = {
  // Surfaces
  base: "#1e1e2e",
  backgroundPanel: "#313244",   // dialog/overlay backgrounds (was surface0)
  backgroundElement: "#45475a", // hover/active states (was surface1)

  // Text hierarchy
  text: "#cdd6f4",
  textMuted: "#a6adc8",         // secondary info (was subtext)
  textDim: "#6c7086",           // hints, line numbers (was overlay)

  // Semantic accents
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
  yellow: "#f9e2af",
  mauve: "#cba6f7",

  // Borders
  border: "#45475a",            // default border color
  borderAccent: "#89b4fa",      // active/focused border

  // Status (matching opencode)
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  info: "#89b4fa",
} as const;

export const STATUS_ICONS: Record<string, string> = {
  open: "\u258c",     // ▌
  pending: "\u258c",  // ▌
  resolved: "\u2713", // ✓
  outdated: "\u258c", // ▌
};

// SplitBorder chars (opencode pattern — left vertical line only)
export const SPLIT_BORDER = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: " ",
  bottomRight: " ",
  horizontal: " ",
  vertical: "\u2503", // ┃
} as const;
```

- [ ] **Step 2: Run tests**

Run: `bun test`
Expected: PASS (no tests reference theme internals directly)

- [ ] **Step 3: Commit**

```bash
git add src/tui/ui/theme.ts
git commit -m "feat(ui): add expanded semantic theme"
```

### Task 2: Hint Bar Builder

**Files:**
- Create: `src/tui/ui/hint-bar.ts`

- [ ] **Step 1: Create hint-bar.ts**

```typescript
import { TextRenderable, TextNodeRenderable } from "@opentui/core";
import { theme } from "./theme";

export interface Hint {
  key: string;
  action: string;
}

/**
 * Build styled hint bar content: [key] action  [key] action
 * Clears existing content and adds TextNodeRenderable children.
 */
export function buildHints(text: TextRenderable, hints: Hint[]): void {
  text.clear();
  text.add(TextNodeRenderable.fromString(" ", {}));
  for (let i = 0; i < hints.length; i++) {
    const h = hints[i];
    text.add(TextNodeRenderable.fromString(`[${h.key}]`, { fg: theme.blue }));
    text.add(TextNodeRenderable.fromString(` ${h.action}`, { fg: theme.textMuted }));
    if (i < hints.length - 1) {
      text.add(TextNodeRenderable.fromString("  ", {}));
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/ui/hint-bar.ts
git commit -m "feat(ui): add reusable hint bar builder"
```

### Task 3: Dialog Factory

**Files:**
- Create: `src/tui/ui/dialog.ts`

- [ ] **Step 1: Create dialog.ts**

Dialog factory inspired by opencode — creates a BoxRenderable with backdrop, border, scroll content area, and hint bar. Wires Esc/Ctrl+C dismissal automatically.

```typescript
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme, SPLIT_BORDER } from "./theme";
import { buildHints, type Hint } from "./hint-bar";

export interface DialogOptions {
  renderer: CliRenderer;
  title: string;
  width?: string | number;   // default "80%"
  height?: string | number;  // default "85%"
  top?: string | number;     // default "5%"
  left?: string | number;    // default "10%"
  borderColor?: string;      // default theme.border
  onDismiss: () => void;
  hints?: Hint[];
}

export interface DialogComponents {
  /** The outermost container — add to renderer.root */
  container: BoxRenderable;
  /** Scrollable content area — add children here */
  content: ScrollBoxRenderable;
  /** Hint bar at bottom — update via setHints() */
  hintText: TextRenderable;
  /** Update hint bar content */
  setHints: (hints: Hint[]) => void;
  /** Cleanup key listeners */
  cleanup: () => void;
}

export function createDialog(opts: DialogOptions): DialogComponents {
  const {
    renderer, title, onDismiss,
    width = "80%", height = "85%",
    top = "5%", left = "10%",
    borderColor = theme.border,
    hints = [],
  } = opts;

  // Container with left-border accent (opencode SplitBorder pattern)
  const container = new BoxRenderable(renderer, {
    position: "absolute",
    top,
    left,
    width,
    height,
    zIndex: 100,
    backgroundColor: theme.backgroundPanel,
    border: true,
    borderStyle: "single",
    borderColor,
    customBorderChars: SPLIT_BORDER,
    title: ` ${title} `,
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
  });

  // Scrollable content area
  const content = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
  });
  container.add(content);

  // Hint bar at bottom
  const hintBox = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
    backgroundColor: theme.backgroundElement,
  });
  const hintText = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    fg: theme.textMuted,
    wrapMode: "none",
    truncate: true,
  });
  hintBox.add(hintText);
  container.add(hintBox);

  if (hints.length > 0) {
    buildHints(hintText, hints);
  }

  function setHints(newHints: Hint[]): void {
    buildHints(hintText, newHints);
    renderer.requestRender();
  }

  // Esc/Ctrl+C dismissal
  const keyHandler = (key: KeyEvent) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      key.preventDefault();
      key.stopPropagation();
      onDismiss();
    }
  };
  renderer.keyInput.on("keypress", keyHandler);

  function cleanup(): void {
    renderer.keyInput.off("keypress", keyHandler);
  }

  return { container, content, hintText, setHints, cleanup };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/ui/dialog.ts
git commit -m "feat(ui): add dialog factory with backdrop and hint bar"
```

### Task 4: Keybind Registry

**Files:**
- Create: `src/tui/ui/keybinds.ts`

- [ ] **Step 1: Create keybinds.ts**

Registry-based keybind matching with sequence support (gg, dd, ]t, [r). Replaces the 280-line switch statement + pending timers in app.ts.

```typescript
import type { KeyEvent } from "@opentui/core";

export interface KeyBinding {
  /** Key pattern: "j", "G" (shift), "C-d" (ctrl), "gg" / "dd" / "]t" (sequence) */
  key: string;
  action: string;
}

interface SequenceState {
  first: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface KeybindRegistry {
  match: (key: KeyEvent) => string | null;
  /** Get pending sequence prefix for display (e.g., "]...") */
  pending: () => string | null;
  destroy: () => void;
}

export function createKeybindRegistry(bindings: KeyBinding[], timeout = 500): KeybindRegistry {
  let sequence: SequenceState | null = null;

  // Separate single-key and sequence bindings
  const singleBindings = new Map<string, string>();
  const sequenceBindings = new Map<string, string>(); // "gg" → action

  for (const b of bindings) {
    if (b.key.length === 2 && !b.key.startsWith("C-")) {
      sequenceBindings.set(b.key, b.action);
    } else {
      singleBindings.set(b.key, b.action);
    }
  }

  // Collect all valid sequence first chars
  const sequenceStarters = new Set<string>();
  for (const key of sequenceBindings.keys()) {
    sequenceStarters.add(key[0]);
  }

  function keyToString(key: KeyEvent): string {
    if (key.ctrl && key.name) return `C-${key.name}`;
    if (key.shift && key.name) return key.name.toUpperCase();
    return key.sequence || key.name || "";
  }

  function match(key: KeyEvent): string | null {
    const keyStr = keyToString(key);

    // Check if we're in a sequence
    if (sequence) {
      const seq = sequence.first + keyStr;
      clearTimeout(sequence.timer);
      sequence = null;

      const action = sequenceBindings.get(seq);
      if (action) return action;
      // Invalid second key — fall through to single match
    }

    // Check if this starts a sequence
    if (sequenceStarters.has(keyStr)) {
      // But also check if there's a ctrl version (C-d should not start "dd" sequence)
      if (key.ctrl) {
        const ctrlKey = `C-${key.name}`;
        const action = singleBindings.get(ctrlKey);
        if (action) return action;
      }

      sequence = {
        first: keyStr,
        timer: setTimeout(() => { sequence = null; }, timeout),
      };
      return null; // waiting for second key
    }

    // Single key match
    // Check ctrl variants first
    if (key.ctrl && key.name) {
      const action = singleBindings.get(`C-${key.name}`);
      if (action) return action;
    }

    // Check shift variants
    if (key.shift && key.name) {
      const upper = key.name.toUpperCase();
      const action = singleBindings.get(upper);
      if (action) return action;
    }

    // Plain key
    const action = singleBindings.get(keyStr);
    if (action) return action;

    return null;
  }

  function pendingStr(): string | null {
    if (!sequence) return null;
    return `${sequence.first}...`;
  }

  function destroy(): void {
    if (sequence) {
      clearTimeout(sequence.timer);
      sequence = null;
    }
  }

  return { match, pending: pendingStr, destroy };
}
```

- [ ] **Step 2: Write test for keybind registry**

Create: `test/tui/ui/keybinds.test.ts`

```typescript
import { describe, expect, it } from "bun:test";
import { createKeybindRegistry } from "../../../src/tui/ui/keybinds";

function makeKey(name: string, opts: { ctrl?: boolean; shift?: boolean; sequence?: string } = {}): any {
  return { name, ctrl: opts.ctrl ?? false, shift: opts.shift ?? false, sequence: opts.sequence ?? name };
}

describe("createKeybindRegistry", () => {
  it("matches single keys", () => {
    const reg = createKeybindRegistry([
      { key: "j", action: "down" },
      { key: "k", action: "up" },
    ]);
    expect(reg.match(makeKey("j"))).toBe("down");
    expect(reg.match(makeKey("k"))).toBe("up");
    expect(reg.match(makeKey("x"))).toBeNull();
    reg.destroy();
  });

  it("matches ctrl keys", () => {
    const reg = createKeybindRegistry([
      { key: "C-d", action: "half-page-down" },
    ]);
    expect(reg.match(makeKey("d", { ctrl: true }))).toBe("half-page-down");
    expect(reg.match(makeKey("d"))).toBeNull();
    reg.destroy();
  });

  it("matches shift keys", () => {
    const reg = createKeybindRegistry([
      { key: "G", action: "goto-bottom" },
      { key: "R", action: "resolve-all" },
    ]);
    expect(reg.match(makeKey("g", { shift: true }))).toBe("goto-bottom");
    expect(reg.match(makeKey("r", { shift: true }))).toBe("resolve-all");
    reg.destroy();
  });

  it("matches two-key sequences", () => {
    const reg = createKeybindRegistry([
      { key: "gg", action: "goto-top" },
      { key: "dd", action: "delete" },
    ]);
    // First key returns null (pending)
    expect(reg.match(makeKey("g"))).toBeNull();
    expect(reg.pending()).toBe("g...");
    // Second key completes
    expect(reg.match(makeKey("g"))).toBe("goto-top");
    expect(reg.pending()).toBeNull();
    reg.destroy();
  });

  it("clears sequence on invalid second key", () => {
    const reg = createKeybindRegistry([
      { key: "gg", action: "goto-top" },
      { key: "j", action: "down" },
    ]);
    expect(reg.match(makeKey("g"))).toBeNull();
    // Invalid second key for "g?" sequence
    expect(reg.match(makeKey("x"))).toBeNull();
    // Should work normally now
    expect(reg.match(makeKey("j"))).toBe("down");
    reg.destroy();
  });

  it("handles bracket sequences", () => {
    const reg = createKeybindRegistry([
      { key: "]t", action: "next-thread" },
      { key: "[t", action: "prev-thread" },
    ]);
    expect(reg.match(makeKey("]", { sequence: "]" }))).toBeNull();
    expect(reg.match(makeKey("t"))).toBe("next-thread");
    reg.destroy();
  });
});
```

- [ ] **Step 3: Run test**

Run: `bun test test/tui/ui/keybinds.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tui/ui/keybinds.ts test/tui/ui/keybinds.test.ts
git commit -m "feat(ui): add keybind registry with sequence support"
```

### Task 5: Extract Markdown Parser

**Files:**
- Create: `src/tui/ui/markdown.ts`
- Modify: `src/tui/pager.ts`

- [ ] **Step 1: Extract markdown + table code from pager.ts to ui/markdown.ts**

Move these functions from pager.ts → ui/markdown.ts:
- `StyledSegment` interface
- `parseInlineMarkdown()`
- `parseMarkdownLine()`
- `addSegments()`
- `SEPARATOR_RE`, `parseTableCells()`, `displayWidth()`
- `TableBlock` interface, `collectTable()`
- `renderTableSeparator()`, `renderTableRow()`, `renderTableBorder()`

Update imports: use `theme` from `./theme` (ui/theme.ts).

Export all public functions.

- [ ] **Step 2: Update pager.ts imports**

Replace local function definitions with:
```typescript
import { parseMarkdownLine, addSegments, collectTable, renderTableBorder, renderTableSeparator, renderTableRow, parseTableCells, type TableBlock } from "./ui/markdown";
import { theme, STATUS_ICONS } from "./ui/theme";
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: PASS (all 163 tests)

- [ ] **Step 4: Commit**

```bash
git add src/tui/ui/markdown.ts src/tui/pager.ts
git commit -m "refactor: extract markdown parser to ui/markdown"
```

---

## Chunk 2: Rewrite Overlays + App

### Task 6: Rewrite Help Overlay

**Files:**
- Modify: `src/tui/help.ts`

- [ ] **Step 1: Rewrite using createDialog()**

```typescript
import { TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { createDialog, type DialogComponents } from "./ui/dialog";
import { theme } from "./ui/theme";

export interface HelpOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

export function createHelp(opts: {
  renderer: CliRenderer;
  version: string;
  onClose: () => void;
}): HelpOverlay {
  const { renderer, version, onClose } = opts;

  const dialog = createDialog({
    renderer,
    title: "Help",
    width: "60%",
    height: Math.min(26, renderer.height - 2),
    top: "10%",
    left: "20%",
    borderColor: theme.info,
    onDismiss: onClose,
    hints: [
      { key: "q/?/Esc", action: "close" },
      { key: "j/k", action: "scroll" },
    ],
  });

  const helpText = [
    "",
    `  revspec v${version}`,
    "",
    "  Navigation",
    "  j/k       Down/up",
    "  gg        Go to first line",
    "  G         Go to last line",
    "  Ctrl+d/u  Half page down/up",
    "  /         Search",
    "  n/N       Next/prev search match",
    "  Esc       Clear search highlights",
    "  ]t/[t     Next/prev thread",
    "  ]r/[r     Next/prev unread thread",
    "",
    "  Review",
    "  c         Comment / view thread / reply",
    "  r         Resolve thread",
    "  R         Resolve all pending",
    "  dd        Delete draft comment",
    "  l         List threads",
    "  a         Approve spec",
    "",
    "  Commands",
    "  :w        Save review",
    "  :q        Save and quit",
    "  :wq       Save and quit",
    "  :q!       Quit without saving",
    "",
  ].join("\n");

  const content = new TextRenderable(renderer, {
    content: helpText,
    width: "100%",
    fg: theme.text,
    wrapMode: "none",
  });
  dialog.content.add(content);

  // Additional key handler for q/? and j/k scroll
  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "q" || key.sequence === "?") {
      key.preventDefault();
      key.stopPropagation();
      onClose();
      return;
    }
    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      dialog.content.scrollBy(1);
      renderer.requestRender();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      dialog.content.scrollBy(-1);
      renderer.requestRender();
      return;
    }
  };
  renderer.keyInput.on("keypress", extraKeyHandler);

  return {
    container: dialog.container,
    cleanup() {
      dialog.cleanup();
      renderer.keyInput.off("keypress", extraKeyHandler);
    },
  };
}
```

- [ ] **Step 2: Run tests + manual test**

Run: `bun test`

- [ ] **Step 3: Commit**

```bash
git add src/tui/help.ts
git commit -m "refactor: rewrite help overlay using createDialog()"
```

### Task 7: Rewrite Confirm Dialog

**Files:**
- Modify: `src/tui/confirm.ts`

- [ ] **Step 1: Rewrite using createDialog()**

```typescript
import { TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { createDialog } from "./ui/dialog";
import { theme } from "./ui/theme";

export interface ConfirmOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

export function createConfirm(opts: {
  renderer: CliRenderer;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ConfirmOverlay {
  const { renderer, message, onConfirm, onCancel } = opts;

  const dialog = createDialog({
    renderer,
    title: "Confirm",
    width: "50%",
    height: 7,
    top: "35%",
    left: "25%",
    borderColor: theme.warning,
    onDismiss: onCancel,
    hints: [
      { key: "y", action: "yes" },
      { key: "n/Esc", action: "no" },
    ],
  });

  const msgText = new TextRenderable(renderer, {
    content: ` ${message}`,
    width: "100%",
    fg: theme.text,
    wrapMode: "word",
  });
  dialog.content.add(msgText);

  const extraKeyHandler = (key: KeyEvent) => {
    if (key.name === "y") {
      key.preventDefault();
      key.stopPropagation();
      onConfirm();
      return;
    }
    if (key.name === "n") {
      key.preventDefault();
      key.stopPropagation();
      onCancel();
      return;
    }
  };
  renderer.keyInput.on("keypress", extraKeyHandler);

  return {
    container: dialog.container,
    cleanup() {
      dialog.cleanup();
      renderer.keyInput.off("keypress", extraKeyHandler);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/confirm.ts
git commit -m "refactor: rewrite confirm dialog using createDialog()"
```

### Task 8: Rewrite Thread List

**Files:**
- Modify: `src/tui/thread-list.ts`

- [ ] **Step 1: Rewrite using createDialog()**

Keep SelectRenderable for the list, but use createDialog() for the container.

```typescript
import {
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import type { Thread } from "../protocol/types";
import { createDialog } from "./ui/dialog";
import { theme, STATUS_ICONS } from "./ui/theme";

export interface ThreadListOverlay {
  container: import("@opentui/core").BoxRenderable;
  cleanup: () => void;
}

const MAX_PREVIEW_LENGTH = 50;

function previewText(thread: Thread): string {
  if (thread.messages.length === 0) return "(empty)";
  const last = thread.messages[thread.messages.length - 1];
  const text = last.text.replace(/\n/g, " ");
  if (text.length <= MAX_PREVIEW_LENGTH) return text;
  return text.slice(0, MAX_PREVIEW_LENGTH - 1) + "\u2026";
}

export function createThreadList(opts: {
  renderer: CliRenderer;
  threads: Thread[];
  onSelect: (lineNumber: number) => void;
  onCancel: () => void;
}): ThreadListOverlay {
  const { renderer, threads, onSelect, onCancel } = opts;
  const activeThreads = threads.filter(t => t.status === "open" || t.status === "pending");

  const dialog = createDialog({
    renderer,
    title: `Threads (${activeThreads.length} active)`,
    width: "70%",
    height: "60%",
    top: "15%",
    left: "15%",
    borderColor: theme.mauve,
    onDismiss: onCancel,
    hints: [
      { key: "j/k", action: "navigate" },
      { key: "Enter", action: "jump" },
      { key: "Esc", action: "close" },
    ],
  });

  if (activeThreads.length > 0) {
    const selectOptions = activeThreads.map(t => ({
      name: `${STATUS_ICONS[t.status]} #${t.id} line ${t.line}: ${previewText(t)}`,
      description: `${t.status} - ${t.messages.length} message(s)`,
      value: t.line,
    }));

    const select = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      options: selectOptions,
      selectedIndex: 0,
      backgroundColor: theme.backgroundPanel,
      textColor: theme.text,
      focusedBackgroundColor: theme.backgroundPanel,
      focusedTextColor: theme.text,
      selectedBackgroundColor: theme.backgroundElement,
      selectedTextColor: theme.mauve,
      descriptionColor: theme.textDim,
      selectedDescriptionColor: theme.textMuted,
      showDescription: true,
      wrapSelection: true,
    });

    dialog.content.add(select);
    renderer.focusRenderable(select);

    select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const selected = select.getSelectedOption();
      if (selected?.value != null) onSelect(selected.value as number);
    });
  }

  return {
    container: dialog.container,
    cleanup: dialog.cleanup,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/thread-list.ts
git commit -m "refactor: rewrite thread-list using createDialog()"
```

### Task 9: Rewrite Comment Input

**Files:**
- Modify: `src/tui/comment-input.ts`

- [ ] **Step 1: Rewrite using createDialog()**

Keep the thread conversation view (message boxes, normal/insert mode, textarea) but use createDialog() for the container. The dialog's built-in Esc handler needs to be overridden since Esc switches modes in insert mode.

This is the most complex overlay — keep the existing thread rendering logic (renderMessage, appendToConversation, normal/insert mode) but replace the manual BoxRenderable container with createDialog().

Key changes:
- Use `createDialog()` for container + hint bar
- Use `dialog.setHints()` to switch between normal/insert hints
- The dialog's Esc handler calls onCancel in normal mode; in insert mode, Esc switches to normal mode (handled by the extra key handler)
- Keep all thread rendering, message appending, scrolling logic

- [ ] **Step 2: Run tests + manual test**

Run: `bun test`

- [ ] **Step 3: Commit**

```bash
git add src/tui/comment-input.ts
git commit -m "refactor: rewrite comment-input using createDialog()"
```

### Task 10: Update Imports Across Codebase

**Files:**
- Modify: `src/tui/pager.ts` — import theme from ui/theme
- Modify: `src/tui/status-bar.ts` — import theme from ui/theme, use buildHints
- Modify: `src/tui/search.ts` — import theme from ui/theme
- Delete: `src/tui/theme.ts`

- [ ] **Step 1: Update all theme imports**

Change all `import { theme } from "./theme"` to `import { theme } from "./ui/theme"` in:
- pager.ts
- status-bar.ts
- search.ts

- [ ] **Step 2: Update status-bar.ts to use buildHints**

Replace the manual hint building in `buildBottomBar` with `buildHints()` from ui/hint-bar.

- [ ] **Step 3: Delete src/tui/theme.ts**

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: consolidate theme imports, delete old theme.ts"
```

### Task 11: Refactor app.ts Keybindings

**Files:**
- Modify: `src/tui/app.ts`

- [ ] **Step 1: Replace switch statement with keybind registry**

In app.ts, replace the `switch (key.name)` block (lines 454-734) and the pending timer state variables with:

1. Define bindings array:
```typescript
const bindings: KeyBinding[] = [
  { key: "j", action: "cursor-down" },
  { key: "k", action: "cursor-up" },
  { key: "C-d", action: "half-page-down" },
  { key: "C-u", action: "half-page-up" },
  { key: "G", action: "goto-bottom" },
  { key: "gg", action: "goto-top" },
  { key: "n", action: "search-next" },
  { key: "N", action: "search-prev" },
  { key: "c", action: "comment" },
  { key: "l", action: "thread-list" },
  { key: "r", action: "resolve" },
  { key: "R", action: "resolve-all" },
  { key: "dd", action: "delete-draft" },
  { key: "a", action: "approve" },
  { key: "]t", action: "next-thread" },
  { key: "[t", action: "prev-thread" },
  { key: "]r", action: "next-unread" },
  { key: "[r", action: "prev-unread" },
  { key: "?", action: "help" },
  { key: "/", action: "search" },
  { key: ":", action: "command-mode" },
];
```

2. Create registry: `const keybinds = createKeybindRegistry(bindings);`

3. Replace the switch with action dispatch:
```typescript
const action = keybinds.match(key);
if (!action) {
  // Show pending sequence hint if waiting
  const p = keybinds.pending();
  if (p) {
    bottomBar.text.content = ` ${p}`;
    renderer.requestRender();
  }
  return;
}

const actions: Record<string, () => void> = {
  "cursor-down": () => { ... },
  "cursor-up": () => { ... },
  // ... all actions
};

actions[action]?.();
```

4. Remove the pending timer state vars (bracketPending, deletePendingTimer, gPendingTimer) — now handled by the registry.

- [ ] **Step 2: Run tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tui/app.ts
git commit -m "refactor: replace switch statement with keybind registry"
```

### Task 12: Final Cleanup

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 163+ tests pass

- [ ] **Step 2: Manual test with revspec**

```bash
bun link
revspec /tmp/test-spec.md
```

Verify:
- Pager renders with inline markdown
- Help overlay (?) opens with new dialog style
- Comment input (c) works with thread view
- Thread list (l) shows active threads
- Confirm dialog (a) shows approve prompt
- Search (/) works from bottom bar
- Keybindings: j/k, gg, G, Ctrl+d/u, ]t/[t, dd all work
- :q exits cleanly

- [ ] **Step 3: Commit any fixes**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: UI refactor complete — opencode patterns adopted"
```

import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  parseColor,
  type CliRenderer,
} from "@opentui/core";
import { theme, STATUS_ICONS } from "./theme";

const MAX_HINT_LENGTH = 40;

function padLineNum(n: number): string {
  const s = String(n);
  if (s.length >= 4) return s;
  return " ".repeat(4 - s.length) + s;
}

function threadHint(thread: Thread): string {
  if (thread.messages.length === 0) return "";
  const last = thread.messages[thread.messages.length - 1];
  const text = last.text.replace(/\n/g, " ");
  if (text.length <= MAX_HINT_LENGTH) return text;
  return text.slice(0, MAX_HINT_LENGTH - 1) + "\u2026";
}

/**
 * Build plain text line-mode content (for commenting).
 * Each line: cursor marker + lineNum + content + thread indicator + hint.
 */
export function buildPagerContent(state: ReviewState, searchQuery?: string | null, unreadThreadIds?: ReadonlySet<string>): string {
  const lines: string[] = [];

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    const prefix = isCursor ? ">" : " ";
    let specText = state.specLines[i];

    if (searchQuery) {
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      specText = specText.replace(regex, (match) => `>>${match}<<`);
    }

    // Thread indicator goes left, next to line number
    let indicator = " ";
    if (thread) {
      const isUnread = unreadThreadIds && unreadThreadIds.has(thread.id);
      indicator = isUnread ? "+" : STATUS_ICONS[thread.status];
    }

    let line = `${prefix}${indicator}${padLineNum(lineNum)}  ${specText}`;

    // Thread hint on the right (truncated preview of last message)
    if (thread) {
      const hint = threadHint(thread);
      if (hint) line += `  ${hint}`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

function createMarkdownStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: parseColor(theme.text) },
    "markup.heading": { fg: parseColor(theme.blue), bold: true },
    "markup.heading.1": { fg: parseColor(theme.blue), bold: true },
    "markup.heading.2": { fg: parseColor(theme.blue), bold: true },
    "markup.heading.3": { fg: parseColor(theme.mauve), bold: true },
    "markup.heading.4": { fg: parseColor(theme.mauve) },
    "markup.heading.5": { fg: parseColor(theme.mauve) },
    "markup.heading.6": { fg: parseColor(theme.mauve) },
    "markup.bold": { fg: parseColor(theme.text), bold: true },
    "markup.strong": { fg: parseColor(theme.text), bold: true },
    "markup.italic": { fg: parseColor(theme.text), italic: true },
    "markup.link": { fg: parseColor(theme.blue) },
    "markup.link.url": { fg: parseColor(theme.blue) },
    "markup.list": { fg: parseColor(theme.yellow) },
    "markup.raw": { fg: parseColor(theme.green) },
    "markup.raw.inline": { fg: parseColor(theme.green) },
    "string": { fg: parseColor(theme.green) },
    "comment": { fg: parseColor(theme.overlay) },
    "punctuation.special": { fg: parseColor(theme.overlay) },
  });
}

export interface PagerComponents {
  scrollBox: ScrollBoxRenderable;
  /** Plain text node for line mode */
  lineNode: TextRenderable;
  /** Rendered markdown node for reading mode */
  markdownNode: MarkdownRenderable;
  /** Current mode */
  mode: "markdown" | "line";
}

/**
 * Create the pager with both a markdown view and a line-mode view.
 * Only one is visible at a time. Toggle with `m`.
 */
export function createPager(renderer: CliRenderer): PagerComponents {
  // Line mode (default) — plain text with line numbers, cursor, thread indicators
  const lineNode = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    wrapMode: "none",
    fg: theme.text,
    bg: theme.base,
  });

  // Markdown mode — rendered markdown, full-width, beautiful reading
  const markdownNode = new MarkdownRenderable(renderer, {
    content: "",
    width: "100%",
    syntaxStyle: createMarkdownStyle(),
    conceal: true,
    visible: false, // hidden by default — line mode is default
  });

  // Scrollable container
  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: true,
    backgroundColor: theme.base,
  });

  scrollBox.add(markdownNode);
  scrollBox.add(lineNode);

  return { scrollBox, lineNode, markdownNode, mode: "line" };
}

/**
 * Toggle between markdown and line mode.
 */
export function togglePagerMode(pager: PagerComponents): void {
  if (pager.mode === "markdown") {
    pager.mode = "line";
    pager.markdownNode.visible = false;
    pager.lineNode.visible = true;
  } else {
    pager.mode = "markdown";
    pager.lineNode.visible = false;
    pager.markdownNode.visible = true;
  }
}

/**
 * Switch to line mode (for commenting).
 */
export function ensureLineMode(pager: PagerComponents): void {
  if (pager.mode !== "line") {
    togglePagerMode(pager);
  }
}

import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { theme, STATUS_ICONS } from "./theme";

const MAX_HINT_LENGTH = 40;

// ANSI escape codes for basic markdown formatting
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

// Cursor line highlight
const CURSOR_BG = "\x1b[48;2;49;50;68m";  // #313244
const CURSOR_RESET = "\x1b[49m";

/**
 * Apply basic markdown formatting to a line using ANSI codes.
 * Handles: headers (#), bold (**), inline code (`), code fences (```), lists (- *)
 */
function formatMarkdownLine(line: string, inCodeBlock: boolean): { formatted: string; toggleCodeBlock: boolean } {
  // Code fence toggle
  if (line.trimStart().startsWith("```")) {
    return {
      formatted: `${ANSI.gray}${line}${ANSI.reset}`,
      toggleCodeBlock: true,
    };
  }

  // Inside code block — dim
  if (inCodeBlock) {
    return { formatted: `${ANSI.green}${line}${ANSI.reset}`, toggleCodeBlock: false };
  }

  // Headers
  const headerMatch = line.match(/^(#{1,6})\s/);
  if (headerMatch) {
    return { formatted: `${ANSI.bold}${ANSI.cyan}${line}${ANSI.reset}`, toggleCodeBlock: false };
  }

  // List items
  if (line.match(/^\s*[-*]\s/)) {
    return { formatted: `${ANSI.yellow}${line}${ANSI.reset}`, toggleCodeBlock: false };
  }

  // Inline formatting: bold **text**, inline code `text`
  let result = line;
  result = result.replace(/\*\*(.+?)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`);
  result = result.replace(/`([^`]+)`/g, `${ANSI.green}$1${ANSI.reset}`);

  return { formatted: result, toggleCodeBlock: false };
}

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
 * Build the pager content string from ReviewState.
 * Each line: lineNum (4-char padded) + "  " + line content + optional status indicator + thread hint
 * The cursor line is prefixed with ">" instead of the leading space.
 */
export function buildPagerContent(state: ReviewState): string {
  const lines: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    const prefix = isCursor ? ">" : " ";
    const lineNumStr = `${ANSI.gray}${padLineNum(lineNum)}${ANSI.reset}`;

    // Format the markdown content
    const { formatted, toggleCodeBlock } = formatMarkdownLine(state.specLines[i], inCodeBlock);
    if (toggleCodeBlock) inCodeBlock = !inCodeBlock;

    let line = `${prefix}${lineNumStr}  ${formatted}`;

    if (thread) {
      const icon = STATUS_ICONS[thread.status];
      const hint = threadHint(thread);
      line += `  ${icon} ${ANSI.dim}${hint}${ANSI.reset}`;
    }

    // Wrap cursor line with background highlight
    if (isCursor) {
      line = `${CURSOR_BG}${line}${CURSOR_RESET}`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

export interface PagerComponents {
  scrollBox: ScrollBoxRenderable;
  textNode: TextRenderable;
}

/**
 * Create the pager ScrollBox + Text renderable pair.
 */
export function createPager(renderer: CliRenderer): PagerComponents {
  const textNode = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    wrapMode: "none",
    bg: theme.base,
  });

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
  });

  scrollBox.add(textNode);

  return { scrollBox, textNode };
}

import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
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
 * Build the pager content string from ReviewState.
 * Plain text — no ANSI codes (OpenTUI handles colors via its own system).
 * Each line: cursor marker + lineNum (4-char padded) + "  " + line content + optional status + hint
 *
 * If searchQuery is provided, occurrences of the query in spec line content
 * are highlighted with [brackets].
 */
export function buildPagerContent(state: ReviewState, searchQuery?: string | null): string {
  const lines: string[] = [];
  const q = searchQuery ? searchQuery.toLowerCase() : null;

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    const prefix = isCursor ? ">" : " ";
    let specText = state.specLines[i];

    // Highlight search matches in spec text
    if (q) {
      specText = highlightMatches(specText, q);
    }

    let line = `${prefix}${padLineNum(lineNum)}  ${specText}`;

    if (thread) {
      const icon = STATUS_ICONS[thread.status];
      const hint = threadHint(thread);
      line += `  ${icon} ${hint}`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Highlight all occurrences of a query in text by wrapping with >> <<.
 * Case-insensitive matching; original casing is preserved.
 */
function highlightMatches(text: string, queryLower: string): string {
  const lower = text.toLowerCase();
  let result = "";
  let pos = 0;
  while (pos < text.length) {
    const idx = lower.indexOf(queryLower, pos);
    if (idx === -1) {
      result += text.slice(pos);
      break;
    }
    result += text.slice(pos, idx);
    result += `>>${text.slice(idx, idx + queryLower.length)}<<`;
    pos = idx + queryLower.length;
  }
  return result;
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
    fg: theme.text,
    bg: theme.base,
  });

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
    backgroundColor: theme.base,
  });

  scrollBox.add(textNode);

  return { scrollBox, textNode };
}

import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
  StyledText,
  type CliRenderer,
} from "@opentui/core";
import { theme, STATUS_ICONS } from "./theme";

const MAX_HINT_LENGTH = 40;

interface Chunk {
  text: string;
  fg?: string;
  bg?: string;
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
 * Split text into styled chunks with search matches highlighted (inverted colors).
 */
function highlightSearch(text: string, query: string, baseFg: string): Chunk[] {
  if (!query) return [{ text, fg: baseFg }];

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const chunks: Chunk[] = [];
  let lastIndex = 0;

  while (lastIndex < text.length) {
    const idx = lowerText.indexOf(lowerQuery, lastIndex);
    if (idx === -1) break;

    if (idx > lastIndex) {
      chunks.push({ text: text.slice(lastIndex, idx), fg: baseFg });
    }
    chunks.push({
      text: text.slice(idx, idx + query.length),
      fg: theme.base,
      bg: theme.yellow,
    });
    lastIndex = idx + query.length;
  }

  if (lastIndex < text.length) {
    chunks.push({ text: text.slice(lastIndex), fg: baseFg });
  }

  if (chunks.length === 0) {
    chunks.push({ text, fg: baseFg });
  }

  return chunks;
}

/**
 * Determine the color/style for a markdown line.
 */
function getMarkdownStyle(line: string, inCodeBlock: boolean): { fg: string } {
  if (line.trimStart().startsWith("```")) {
    return { fg: theme.overlay };
  }
  if (inCodeBlock) {
    return { fg: theme.green };
  }
  if (line.match(/^#{1,6}\s/)) {
    return { fg: theme.blue };
  }
  if (line.match(/^\s*[-*]\s/)) {
    return { fg: theme.yellow };
  }
  return { fg: theme.text };
}

/**
 * Build the pager content as a StyledText with colored chunks.
 * Supports: markdown formatting, search highlighting (inverted), thread indicators.
 */
export function buildStyledPagerContent(state: ReviewState, searchQuery?: string | null): StyledText {
  const allChunks: Chunk[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    if (i > 0) allChunks.push({ text: "\n" });

    // Cursor marker
    allChunks.push({ text: isCursor ? ">" : " ", fg: isCursor ? theme.yellow : theme.text });

    // Line number
    allChunks.push({ text: padLineNum(lineNum) + "  ", fg: theme.overlay });

    // Code fence toggle
    const rawLine = state.specLines[i];
    const isFence = rawLine.trimStart().startsWith("```");
    if (isFence) inCodeBlock = !inCodeBlock;

    // Line content: markdown style + search highlighting
    const style = getMarkdownStyle(rawLine, inCodeBlock && !isFence);
    const contentChunks = searchQuery
      ? highlightSearch(rawLine, searchQuery, style.fg)
      : [{ text: rawLine, fg: style.fg }];
    allChunks.push(...contentChunks);

    // Thread indicator
    if (thread) {
      const icon = STATUS_ICONS[thread.status];
      const hint = threadHint(thread);
      allChunks.push({ text: `  ${icon} `, fg: theme.overlay });
      allChunks.push({ text: hint, fg: theme.overlay });
    }
  }

  return new StyledText(allChunks);
}

/**
 * Plain text version for testing (no StyledText dependency).
 */
export function buildPagerContent(state: ReviewState, searchQuery?: string | null): string {
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

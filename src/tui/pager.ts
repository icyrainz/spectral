import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
  TextNodeRenderable,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core";
import { theme } from "./theme";

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

// --- Inline markdown parser ---

interface StyledSegment {
  text: string;
  fg?: string;
  attributes?: number;
}

/**
 * Parse inline markdown (bold, italic, code) into styled segments.
 * Strips syntax markers and returns display text with style info.
 */
function parseInlineMarkdown(text: string): StyledSegment[] {
  const segments: StyledSegment[] = [];
  // Order matters: **bold** before *italic*
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let pos = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > pos) {
      segments.push({ text: text.slice(pos, match.index) });
    }
    if (match[2] !== undefined) {
      // **bold**
      segments.push({ text: match[2], attributes: TextAttributes.BOLD });
    } else if (match[3] !== undefined) {
      // *italic*
      segments.push({ text: match[3], attributes: TextAttributes.ITALIC });
    } else if (match[4] !== undefined) {
      // `code`
      segments.push({ text: match[4], fg: theme.green });
    }
    pos = match.index + match[0].length;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }
  if (segments.length === 0) {
    segments.push({ text });
  }
  return segments;
}

/**
 * Parse a full line of markdown into styled segments.
 * Handles block-level syntax (headings, lists, blockquotes, hr)
 * and delegates inline content to parseInlineMarkdown.
 */
function parseMarkdownLine(line: string): StyledSegment[] {
  // Heading: # ... ###### (strip markers, bold + colored)
  const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const color = level <= 2 ? theme.blue : theme.mauve;
    // Parse inline markdown within heading text
    const inner = parseInlineMarkdown(headingMatch[2]);
    return inner.map((s) => ({
      ...s,
      fg: s.fg ?? color,
      attributes: (s.attributes ?? 0) | TextAttributes.BOLD,
    }));
  }

  // Horizontal rule: --- or *** or ___
  if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
    return [{ text: "\u2500".repeat(40), fg: theme.overlay, attributes: TextAttributes.DIM }];
  }

  // Blockquote: > text
  if (line.startsWith("> ")) {
    const inner = parseInlineMarkdown(line.slice(2));
    return [
      { text: "\u2502 ", fg: theme.overlay },
      ...inner.map((s) => ({
        ...s,
        fg: s.fg ?? theme.overlay,
        attributes: (s.attributes ?? 0) | TextAttributes.ITALIC,
      })),
    ];
  }

  // Unordered list: - item, * item, + item
  const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
  if (ulMatch) {
    return [
      { text: ulMatch[1] + "\u2022 ", fg: theme.yellow },
      ...parseInlineMarkdown(ulMatch[3]),
    ];
  }

  // Ordered list: 1. item
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
  if (olMatch) {
    return [
      { text: `${olMatch[1]}${olMatch[2]}. `, fg: theme.yellow },
      ...parseInlineMarkdown(olMatch[3]),
    ];
  }

  // Regular line — parse inline markdown only
  return parseInlineMarkdown(line);
}

/**
 * Add styled segments as TextNodeRenderable children to a parent.
 */
function addSegments(parent: TextRenderable, segments: StyledSegment[], defaultFg: string): void {
  for (const seg of segments) {
    const node = TextNodeRenderable.fromString(seg.text, {
      fg: seg.fg ?? defaultFg,
      attributes: seg.attributes,
    });
    parent.add(node);
  }
}

// --- Table rendering ---

const SEPARATOR_RE = /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/;

/** Split a table row into trimmed cell values (strips outer pipes). */
function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading/trailing pipes and split
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailing = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutTrailing.split("|").map((c) => c.trim());
}

/** Compute the display width of a string (strips inline markdown markers). */
function displayWidth(text: string): number {
  // Remove **bold**, *italic*, `code` markers to get display length
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .length;
}

interface TableBlock {
  startIndex: number;
  lines: string[];
  separatorIndex: number; // relative to startIndex, -1 if none
  colWidths: number[];
}

/** Scan ahead from a starting `|` line and collect the full table block. */
function collectTable(specLines: string[], start: number): TableBlock {
  const lines: string[] = [];
  let i = start;
  while (i < specLines.length && specLines[i].trimStart().startsWith("|")) {
    lines.push(specLines[i]);
    i++;
  }

  // Find separator row
  let separatorIndex = -1;
  for (let j = 0; j < lines.length; j++) {
    if (SEPARATOR_RE.test(lines[j])) {
      separatorIndex = j;
      break;
    }
  }

  // Calculate column widths from all non-separator rows
  const allCells = lines
    .filter((_, j) => j !== separatorIndex)
    .map(parseTableCells);
  const maxCols = Math.max(...allCells.map((r) => r.length), 0);
  const colWidths: number[] = new Array(maxCols).fill(0);
  for (const row of allCells) {
    for (let c = 0; c < row.length; c++) {
      colWidths[c] = Math.max(colWidths[c], displayWidth(row[c]));
    }
  }
  // Minimum width of 3 per column
  for (let c = 0; c < colWidths.length; c++) {
    colWidths[c] = Math.max(colWidths[c], 3);
  }

  return { startIndex: start, lines, separatorIndex, colWidths };
}

/** Render a table separator row with box-drawing characters. */
function renderTableSeparator(parent: TextRenderable, colWidths: number[]): void {
  const parts = colWidths.map((w) => "\u2500".repeat(w + 2));
  const line = "\u251c" + parts.join("\u253c") + "\u2524";
  parent.add(TextNodeRenderable.fromString(line, { fg: theme.overlay }));
}

/** Render a table data/header row with padded, styled cells. */
function renderTableRow(
  parent: TextRenderable,
  cells: string[],
  colWidths: number[],
  isHeader: boolean,
): void {
  for (let c = 0; c < colWidths.length; c++) {
    const cellText = c < cells.length ? cells[c] : "";
    const dw = displayWidth(cellText);
    const padding = Math.max(0, colWidths[c] - dw);

    // Left border
    parent.add(TextNodeRenderable.fromString(
      c === 0 ? "\u2502 " : " \u2502 ",
      { fg: theme.overlay }
    ));

    // Cell content — parse inline markdown, apply header bold
    const segments = parseInlineMarkdown(cellText);
    for (const seg of segments) {
      const attrs = isHeader
        ? (seg.attributes ?? 0) | TextAttributes.BOLD
        : seg.attributes;
      parent.add(TextNodeRenderable.fromString(seg.text, {
        fg: seg.fg ?? theme.text,
        attributes: attrs,
      }));
    }

    // Padding
    if (padding > 0) {
      parent.add(TextNodeRenderable.fromString(" ".repeat(padding), {}));
    }
  }
  // Right border
  parent.add(TextNodeRenderable.fromString(
    " \u2502",
    { fg: theme.overlay }
  ));
}

/** Render a top or bottom border for the table. */
function renderTableBorder(parent: TextRenderable, colWidths: number[], position: "top" | "bottom"): void {
  const [left, mid, right] = position === "top"
    ? ["\u250c", "\u252c", "\u2510"]
    : ["\u2514", "\u2534", "\u2518"];
  const parts = colWidths.map((w) => "\u2500".repeat(w + 2));
  parent.add(TextNodeRenderable.fromString(
    left + parts.join(mid) + right,
    { fg: theme.overlay }
  ));
}

// --- Plain text builder (for tests) ---

/**
 * Build plain text line-mode content (for testing / plain fallback).
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
    let indicator = " ";
    if (thread) {
      const isUnread = unreadThreadIds && unreadThreadIds.has(thread.id);
      if (isUnread) {
        indicator = "\u2588";
      } else if (thread.status === "resolved") {
        indicator = "\u2713";
      } else {
        indicator = "\u258c";
      }
    }
    lines.push(`${prefix}${indicator}${padLineNum(lineNum)}  ${specText}`);
  }
  return lines.join("\n");
}

// --- Styled node builder ---

/**
 * Build styled line-mode content using TextNodeRenderable.
 * Inline markdown is parsed and styled per line.
 * Line numbers and thread hints are dimmed.
 */
export function buildPagerNodes(lineNode: TextRenderable, state: ReviewState, searchQuery?: string | null, unreadThreadIds?: ReadonlySet<string>): void {
  lineNode.clear();

  // Pre-scan for table blocks so we can calculate column widths
  const tableBlocks = new Map<number, TableBlock>();
  for (let i = 0; i < state.specLines.length; i++) {
    if (state.specLines[i].trimStart().startsWith("|") && !tableBlocks.has(i)) {
      const block = collectTable(state.specLines, i);
      // Mark all lines in this block
      for (let j = 0; j < block.lines.length; j++) {
        tableBlocks.set(i + j, block);
      }
    }
  }

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    const prefix = isCursor ? ">" : " ";
    const specText = state.specLines[i];

    // Thread indicator — gutter bar on the left
    let indicator = " ";
    let indicatorColor = theme.overlay;
    if (thread) {
      const isUnread = unreadThreadIds && unreadThreadIds.has(thread.id);
      if (isUnread) {
        indicator = "\u2588"; // █ full block — unread reply
        indicatorColor = theme.yellow;
      } else if (thread.status === "resolved") {
        indicator = "\u2713"; // ✓ resolved
        indicatorColor = theme.green;
      } else {
        indicator = "\u258c"; // ▌ half block — has thread
        indicatorColor = theme.blue;
      }
    }

    // Check for table context before rendering gutter
    const tableBlock = tableBlocks.get(i);
    const isTable = tableBlock && !searchQuery;
    const relIdx = isTable ? i - tableBlock.startIndex : -1;

    // Top border before first table row (on its own visual line with blank gutter)
    if (isTable && relIdx === 0) {
      lineNode.add(TextNodeRenderable.fromString("        ", { fg: theme.overlay }));
      renderTableBorder(lineNode, tableBlock.colWidths, "top");
      lineNode.add(TextNodeRenderable.fromString("\n", {}));
    }

    // Gutter: cursor + indicator + line number (dimmed)
    lineNode.add(TextNodeRenderable.fromString(
      `${prefix}`,
      { fg: isCursor ? theme.text : theme.overlay }
    ));
    lineNode.add(TextNodeRenderable.fromString(
      indicator,
      { fg: indicatorColor }
    ));
    lineNode.add(TextNodeRenderable.fromString(
      `${padLineNum(lineNum)}  `,
      { fg: theme.overlay, attributes: TextAttributes.DIM }
    ));

    // Spec text — table or regular markdown
    if (isTable) {
      if (relIdx === tableBlock.separatorIndex) {
        // Separator row → box-drawing line
        renderTableSeparator(lineNode, tableBlock.colWidths);
      } else {
        // Header (before separator) or data (after separator)
        const isHeader = tableBlock.separatorIndex >= 0 && relIdx < tableBlock.separatorIndex;
        const cells = parseTableCells(specText);
        renderTableRow(lineNode, cells, tableBlock.colWidths, isHeader);
      }

      // Bottom border after last row (on its own visual line with blank gutter)
      if (relIdx === tableBlock.lines.length - 1) {
        lineNode.add(TextNodeRenderable.fromString("\n", {}));
        lineNode.add(TextNodeRenderable.fromString("        ", { fg: theme.overlay }));
        renderTableBorder(lineNode, tableBlock.colWidths, "bottom");
      }
    } else if (searchQuery) {
      // When searching, show raw text with search markers (no markdown styling)
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const highlighted = specText.replace(regex, (match) => `>>${match}<<`);
      lineNode.add(TextNodeRenderable.fromString(highlighted, { fg: theme.text }));
    } else {
      // Parse and render inline markdown
      const segments = parseMarkdownLine(specText);
      addSegments(lineNode, segments, theme.text);
    }

    // Thread hint (dimmed, inline)
    if (thread && thread.messages.length > 0) {
      const hint = threadHint(thread);
      lineNode.add(TextNodeRenderable.fromString(
        `  \u00ab ${hint}`,
        { fg: theme.overlay, attributes: TextAttributes.DIM }
      ));
    }

    // Newline between lines (except last)
    if (i < state.specLines.length - 1) {
      lineNode.add(TextNodeRenderable.fromString("\n", {}));
    }
  }
}

// --- Visual row offset calculation ---

/**
 * Count extra visual lines (table borders) before a given spec line index.
 * Used to map spec line numbers to actual visual rows in the rendered content.
 */
export function countExtraVisualLines(specLines: string[], cursorIndex: number): number {
  let extra = 0;
  let i = 0;
  while (i < specLines.length) {
    if (specLines[i].trimStart().startsWith("|")) {
      const tableStart = i;
      while (i < specLines.length && specLines[i].trimStart().startsWith("|")) {
        i++;
      }
      const tableEnd = i; // first line AFTER the table

      // Top border: rendered before first table row
      if (cursorIndex >= tableStart) extra++;
      // Bottom border: rendered after last table row
      if (cursorIndex >= tableEnd) extra++;
      continue;
    }
    i++;
  }
  return extra;
}

// --- Pager components ---

export interface PagerComponents {
  scrollBox: ScrollBoxRenderable;
  lineNode: TextRenderable;
}

/**
 * Create the pager — single styled line-mode view with inline markdown.
 */
export function createPager(renderer: CliRenderer): PagerComponents {
  const lineNode = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    wrapMode: "none",
    fg: theme.text,
    bg: theme.base,
  });

  const scrollBox = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    scrollY: true,
    scrollX: true,
    backgroundColor: theme.base,
  });

  scrollBox.add(lineNode);

  return { scrollBox, lineNode };
}

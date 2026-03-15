import {
  TextRenderable,
  TextNodeRenderable,
  TextAttributes,
} from "@opentui/core";
import { theme } from "./theme";

// --- Inline markdown parser ---

export interface StyledSegment {
  text: string;
  fg?: string;
  attributes?: number;
}

/**
 * Parse inline markdown (bold italic, bold, italic, code, links, strikethrough) into styled segments.
 * Strips syntax markers and returns display text with style info.
 * Order matters: longer patterns first (***bold italic*** before **bold** before *italic*).
 */
export function parseInlineMarkdown(text: string): StyledSegment[] {
  const segments: StyledSegment[] = [];
  // Groups:
  //   2: ***bold italic***
  //   3: **bold**
  //   4: *italic*
  //   5: __bold__
  //   6: _italic_
  //   7: ~~strikethrough~~
  //   8: [link text](url) — display text only
  //   9: `code`
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|~~(.+?)~~|\[([^\]]+)\]\([^)]+\)|`([^`]+)`)/g;
  let pos = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > pos) {
      segments.push({ text: text.slice(pos, match.index) });
    }
    if (match[2] !== undefined) {
      // ***bold italic***
      segments.push({ text: match[2], attributes: TextAttributes.BOLD | TextAttributes.ITALIC });
    } else if (match[3] !== undefined) {
      // **bold**
      segments.push({ text: match[3], attributes: TextAttributes.BOLD });
    } else if (match[4] !== undefined) {
      // *italic*
      segments.push({ text: match[4], attributes: TextAttributes.ITALIC });
    } else if (match[5] !== undefined) {
      // __bold__
      segments.push({ text: match[5], attributes: TextAttributes.BOLD });
    } else if (match[6] !== undefined) {
      // _italic_
      segments.push({ text: match[6], attributes: TextAttributes.ITALIC });
    } else if (match[7] !== undefined) {
      // ~~strikethrough~~ — dim as fallback (terminal strikethrough unreliable)
      segments.push({ text: match[7], attributes: TextAttributes.DIM });
    } else if (match[8] !== undefined) {
      // [link text](url) — show text in blue + underline
      segments.push({ text: match[8], fg: theme.blue, attributes: TextAttributes.UNDERLINE });
    } else if (match[9] !== undefined) {
      // `code`
      segments.push({ text: match[9], fg: theme.mauve });
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
export function parseMarkdownLine(line: string): StyledSegment[] {
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
    return [{ text: "\u2500".repeat(40), fg: theme.textDim, attributes: TextAttributes.DIM }];
  }

  // Blockquote: > text
  if (line.startsWith("> ")) {
    const inner = parseInlineMarkdown(line.slice(2));
    return [
      { text: "\u2502 ", fg: theme.mauve },
      ...inner.map((s) => ({
        ...s,
        fg: s.fg ?? theme.textDim,
        attributes: (s.attributes ?? 0) | TextAttributes.ITALIC,
      })),
    ];
  }

  // Task list: - [ ] or - [x]
  const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)/);
  if (taskMatch) {
    const checked = taskMatch[2].toLowerCase() === "x";
    const checkbox = checked ? "\u2611 " : "\u2610 "; // ☑ or ☐
    const color = checked ? theme.green : theme.textDim;
    return [
      { text: taskMatch[1] + checkbox, fg: color },
      ...parseInlineMarkdown(taskMatch[3]),
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
export function addSegments(parent: TextRenderable, segments: StyledSegment[], defaultFg: string, bg?: string): void {
  for (const seg of segments) {
    const node = TextNodeRenderable.fromString(seg.text, {
      fg: seg.fg ?? defaultFg,
      attributes: seg.attributes,
      bg,
    });
    parent.add(node);
  }
}

// --- Table rendering ---

export const SEPARATOR_RE = /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/;

/** Split a table row into trimmed cell values (strips outer pipes). */
export function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading/trailing pipes and split
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailing = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutTrailing.split("|").map((c) => c.trim());
}

/** Compute the display width of a string (strips inline markdown markers). */
export function displayWidth(text: string): number {
  // Remove all inline markdown markers to get display length
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .length;
}

export interface TableBlock {
  startIndex: number;
  lines: string[];
  separatorIndex: number; // relative to startIndex, -1 if none
  colWidths: number[];
}

/** Scan ahead from a starting `|` line and collect the full table block. */
export function collectTable(specLines: string[], start: number): TableBlock {
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
export function renderTableSeparator(parent: TextRenderable, colWidths: number[]): void {
  const parts = colWidths.map((w) => "\u2500".repeat(w + 2));
  const line = "\u251c" + parts.join("\u253c") + "\u2524";
  parent.add(TextNodeRenderable.fromString(line, { fg: theme.textDim }));
}

/** Render a table data/header row with padded, styled cells. */
export function renderTableRow(
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
      { fg: theme.textDim }
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
    { fg: theme.textDim }
  ));
}

/** Render a top or bottom border for the table. */
export function renderTableBorder(parent: TextRenderable, colWidths: number[], position: "top" | "bottom"): void {
  const [left, mid, right] = position === "top"
    ? ["\u250c", "\u252c", "\u2510"]
    : ["\u2514", "\u2534", "\u2518"];
  const parts = colWidths.map((w) => "\u2500".repeat(w + 2));
  parent.add(TextNodeRenderable.fromString(
    left + parts.join(mid) + right,
    { fg: theme.textDim }
  ));
}

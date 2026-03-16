import type { ReviewState } from "../state/review-state";
import {
  ScrollBoxRenderable,
  TextRenderable,
  TextNodeRenderable,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { parseMarkdownLine, addSegments, collectTable, renderTableBorder, renderTableSeparator, renderTableRow, parseTableCells, type TableBlock, type StyledSegment } from "./ui/markdown";

// --- Plain text builder (for tests) ---

/**
 * Build plain text line-mode content (for testing / plain fallback).
 */
export function buildPagerContent(state: ReviewState, searchQuery?: string | null, unreadThreadIds?: ReadonlySet<string>): string {
  const numWidth = Math.max(String(state.lineCount).length, 3);
  const lines: string[] = [];
  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;
    const prefix = isCursor ? ">" : " ";
    let specText = state.specLines[i];
    if (searchQuery) {
      const csSensitive = searchQuery !== searchQuery.toLowerCase();
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), csSensitive ? "g" : "gi");
      specText = specText.replace(regex, (match) => `>>${match}<<`);
    }
    let indicator = " ";
    if (thread) {
      const isUnread = unreadThreadIds && unreadThreadIds.has(thread.id);
      if (isUnread) {
        indicator = "\u2588";
      } else if (thread.status === "resolved") {
        indicator = "=";
      } else {
        indicator = "\u258c";
      }
    }
    const numStr = String(lineNum);
    const padded = " ".repeat(numWidth - numStr.length) + numStr;
    lines.push(`${prefix}${indicator}${padded}  ${specText}`);
  }
  return lines.join("\n");
}

// --- Styled node builder ---

/**
 * Build styled line-mode content using TextNodeRenderable.
 * Inline markdown is parsed and styled per line.
 * Line numbers and thread hints are dimmed.
 */
/**
 * Wrap pre-parsed markdown segments at the given width.
 * Breaks at segment boundaries when possible, word boundaries within segments otherwise.
 * Returns an array of segment arrays (one per visual line).
 */
function wrapSegments(segments: StyledSegment[], width: number): StyledSegment[][] {
  if (width <= 0) return [segments];
  // Check total length
  let totalLen = 0;
  for (const s of segments) totalLen += s.text.length;
  if (totalLen <= width) return [segments];

  const lines: StyledSegment[][] = [];
  let curLine: StyledSegment[] = [];
  let curWidth = 0;

  for (const seg of segments) {
    if (curWidth + seg.text.length <= width) {
      curLine.push(seg);
      curWidth += seg.text.length;
      continue;
    }
    // Segment doesn't fit — break it at word boundaries
    let remaining = seg.text;
    while (remaining.length > 0) {
      const avail = width - curWidth;
      if (remaining.length <= avail) {
        curLine.push({ ...seg, text: remaining });
        curWidth += remaining.length;
        break;
      }
      if (avail > 0) {
        let breakAt = remaining.lastIndexOf(" ", avail);
        if (breakAt <= 0) breakAt = avail; // hard break
        curLine.push({ ...seg, text: remaining.slice(0, breakAt) });
        remaining = remaining.slice(breakAt).replace(/^ /, "");
      }
      lines.push(curLine);
      curLine = [];
      curWidth = 0;
    }
  }
  if (curLine.length > 0) lines.push(curLine);
  return lines;
}

/**
 * Word-wrap a raw string (for countExtraVisualLines estimation).
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    let breakAt = remaining.lastIndexOf(" ", width);
    if (breakAt <= 0) breakAt = width;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^ /, "");
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}

export function buildPagerNodes(lineNode: TextRenderable, state: ReviewState, searchQuery?: string | null, unreadThreadIds?: ReadonlySet<string>, wrapWidth?: number): void {
  lineNode.clear();

  // Calculate dynamic gutter width based on total line count
  const numWidth = Math.max(String(state.lineCount).length, 3);
  const gutterWidth = 2 + numWidth + 2; // prefix(1) + indicator(1) + numWidth + spaces(2)
  // Blank gutter for table borders and wrap continuations
  const gutterBlank = " ".repeat(gutterWidth);
  // Available content width for wrapping
  const contentWidth = wrapWidth && wrapWidth > gutterWidth ? wrapWidth - gutterWidth : 0;

  // Pre-scan for table blocks so we can calculate column widths
  // Skip lines inside fenced code blocks — pipes in code are not tables
  const tableBlocks = new Map<number, TableBlock>();
  let preScanCodeBlock = false;
  for (let i = 0; i < state.specLines.length; i++) {
    if (state.specLines[i].trimStart().startsWith("```")) {
      preScanCodeBlock = !preScanCodeBlock;
      continue;
    }
    if (preScanCodeBlock) continue;
    if (state.specLines[i].trimStart().startsWith("|") && !tableBlocks.has(i)) {
      const block = collectTable(state.specLines, i);
      for (let j = 0; j < block.lines.length; j++) {
        tableBlocks.set(i + j, block);
      }
    }
  }

  // Track fenced code block state
  let inCodeBlock = false;

  for (let i = 0; i < state.specLines.length; i++) {
    const lineNum = i + 1;
    const thread = state.threadAtLine(lineNum);
    const isCursor = lineNum === state.cursorLine;

    const prefix = isCursor ? ">" : " ";
    const specText = state.specLines[i];

    // Thread indicator — gutter bar on the left
    let indicator = " ";
    let indicatorColor: string = theme.textDim;
    if (thread) {
      const isUnread = unreadThreadIds && unreadThreadIds.has(thread.id);
      if (isUnread) {
        indicator = "\u2588"; // █ full block — unread reply
        indicatorColor = theme.yellow;
      } else if (thread.status === "resolved") {
        indicator = "="; // resolved
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
      lineNode.add(TextNodeRenderable.fromString(gutterBlank, { fg: theme.textDim }));
      renderTableBorder(lineNode, tableBlock.colWidths, "top");
      lineNode.add(TextNodeRenderable.fromString("\n", {}));
    }

    // Gutter: cursor + indicator + line number (dimmed)
    lineNode.add(TextNodeRenderable.fromString(
      `${prefix}`,
      { fg: isCursor ? theme.mauve : theme.textDim, bg: isCursor ? theme.backgroundElement : undefined }
    ));
    lineNode.add(TextNodeRenderable.fromString(
      indicator,
      { fg: indicatorColor, bg: isCursor ? theme.backgroundElement : undefined }
    ));
    const numStr = String(lineNum);
    const paddedNum = " ".repeat(numWidth - numStr.length) + numStr;
    lineNode.add(TextNodeRenderable.fromString(
      `${paddedNum}  `,
      { fg: theme.textDim, attributes: TextAttributes.DIM, bg: isCursor ? theme.backgroundElement : undefined }
    ));

    // Spec text — fenced code block, table, or regular markdown
    if (specText.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      // Render the fence line itself as dim
      lineNode.add(TextNodeRenderable.fromString(specText, {
        fg: theme.textDim,
        bg: isCursor ? theme.backgroundElement : undefined,
      }));
    } else if (inCodeBlock) {
      // Inside code block — render as green, no markdown parsing
      lineNode.add(TextNodeRenderable.fromString(specText, {
        fg: theme.green,
        bg: isCursor ? theme.backgroundElement : undefined,
      }));
    } else if (isTable) {
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
        lineNode.add(TextNodeRenderable.fromString(gutterBlank, { fg: theme.textDim }));
        renderTableBorder(lineNode, tableBlock.colWidths, "bottom");
      }
    } else if (searchQuery && (() => {
      const cs = searchQuery !== searchQuery.toLowerCase();
      return cs ? specText.includes(searchQuery) : specText.toLowerCase().includes(searchQuery.toLowerCase());
    })()) {
      // Line contains search match — show colored match segments (no markdown styling)
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const caseSensitive = searchQuery !== searchQuery.toLowerCase();
      const searchRegex = new RegExp(`(${escaped})`, caseSensitive ? "g" : "gi");
      const parts = specText.split(searchRegex);
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (part.length === 0) continue;
        const isMatch = p % 2 === 1; // split with capture group: [before, match, between, match, after]
        if (isMatch) {
          lineNode.add(TextNodeRenderable.fromString(part, { fg: theme.base, bg: theme.yellow, attributes: TextAttributes.BOLD }));
        } else {
          lineNode.add(TextNodeRenderable.fromString(part, { fg: theme.text, bg: isCursor ? theme.backgroundElement : undefined }));
        }
      }
    } else {
      // Parse inline markdown, then wrap if needed
      const segments = parseMarkdownLine(specText);
      const bg = isCursor ? theme.backgroundElement : undefined;
      if (contentWidth > 0 && specText.length > contentWidth) {
        const wrapped = wrapSegments(segments, contentWidth);
        addSegments(lineNode, wrapped[0], theme.text, bg);
        for (let c = 1; c < wrapped.length; c++) {
          lineNode.add(TextNodeRenderable.fromString("\n", {}));
          lineNode.add(TextNodeRenderable.fromString(gutterBlank, { fg: theme.textDim }));
          addSegments(lineNode, wrapped[c], theme.text, bg);
        }
      } else {
        addSegments(lineNode, segments, theme.text, bg);
      }
    }

    // Newline between lines (except last)
    if (i < state.specLines.length - 1) {
      lineNode.add(TextNodeRenderable.fromString("\n", {}));
    }
  }
}

// --- Visual row offset calculation ---

/**
 * Count extra visual lines (table borders + word wrap) before a given spec line index.
 * Used to map spec line numbers to actual visual rows in the rendered content.
 */
export function countExtraVisualLines(specLines: string[], cursorIndex: number, wrapWidth?: number): number {
  const numWidth = Math.max(String(specLines.length).length, 3);
  const gutterWidth = 2 + numWidth + 2;
  const contentWidth = wrapWidth && wrapWidth > gutterWidth ? wrapWidth - gutterWidth : 0;

  let extra = 0;
  let i = 0;
  let inCode = false;
  while (i < specLines.length) {
    if (specLines[i].trimStart().startsWith("```")) {
      inCode = !inCode;
      i++;
      continue;
    }
    if (!inCode && specLines[i].trimStart().startsWith("|")) {
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
    // Word wrap: count extra continuation lines (not in code blocks — those render unwrapped)
    if (!inCode && contentWidth > 0 && i < cursorIndex && specLines[i].length > contentWidth) {
      extra += wordWrap(specLines[i], contentWidth).length - 1;
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
    scrollX: false,
    backgroundColor: theme.base,
  });

  scrollBox.add(lineNode);

  return { scrollBox, lineNode };
}

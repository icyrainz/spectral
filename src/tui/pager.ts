import type { ReviewState } from "../state/review-state";
import type { Thread } from "../protocol/types";
import {
  ScrollBoxRenderable,
  TextRenderable,
  TextNodeRenderable,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core";
import { theme } from "./ui/theme";
import { parseMarkdownLine, addSegments, collectTable, renderTableBorder, renderTableSeparator, renderTableRow, parseTableCells, type TableBlock } from "./ui/markdown";

const MAX_HINT_LENGTH = 40;

function threadHint(thread: Thread): string {
  if (thread.messages.length === 0) return "";
  const last = thread.messages[thread.messages.length - 1];
  const text = last.text.replace(/\n/g, " ");
  if (text.length <= MAX_HINT_LENGTH) return text;
  return text.slice(0, MAX_HINT_LENGTH - 1) + "\u2026";
}

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
export function buildPagerNodes(lineNode: TextRenderable, state: ReviewState, searchQuery?: string | null, unreadThreadIds?: ReadonlySet<string>): void {
  lineNode.clear();

  // Calculate dynamic gutter width based on total line count
  const numWidth = Math.max(String(state.lineCount).length, 3);
  // Blank gutter for table borders: prefix(1) + indicator(1) + numWidth + spaces(2)
  const gutterBlank = " ".repeat(2 + numWidth + 2);

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
      lineNode.add(TextNodeRenderable.fromString(gutterBlank, { fg: theme.textDim }));
      renderTableBorder(lineNode, tableBlock.colWidths, "top");
      lineNode.add(TextNodeRenderable.fromString("\n", {}));
    }

    // Gutter: cursor + indicator + line number (dimmed)
    lineNode.add(TextNodeRenderable.fromString(
      `${prefix}`,
      { fg: isCursor ? theme.text : theme.textDim, bg: isCursor ? theme.backgroundElement : undefined }
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
    } else if (searchQuery) {
      // When searching, show colored match segments (no markdown styling)
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(`(${escaped})`, "gi");
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
      // Parse and render inline markdown
      const segments = parseMarkdownLine(specText);
      addSegments(lineNode, segments, theme.text, isCursor ? theme.backgroundElement : undefined);
    }

    // Thread hint (dimmed, inline)
    if (thread && thread.messages.length > 0) {
      const hint = threadHint(thread);
      lineNode.add(TextNodeRenderable.fromString(
        `  \u00ab ${hint}`,
        { fg: theme.textDim, attributes: TextAttributes.DIM, bg: isCursor ? theme.backgroundElement : undefined }
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

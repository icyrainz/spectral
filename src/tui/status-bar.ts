import { BoxRenderable, TextRenderable, TextNodeRenderable, TextAttributes, type CliRenderer } from "@opentui/core";
import type { ReviewState } from "../state/review-state";
import { basename } from "path";
import { theme } from "./ui/theme";
import { buildHints, type Hint } from "./ui/hint-bar";

export interface TopBarComponents {
  box: BoxRenderable;
  text: TextRenderable;
}

export interface BottomBarComponents {
  box: BoxRenderable;
  text: TextRenderable;
}

/**
 * Build the top bar with styled TextNodes.
 */
export function buildTopBar(
  bar: TopBarComponents,
  specFile: string,
  state: ReviewState,
  unreadCount?: number,
  specChanged?: boolean,
): void {
  const t = bar.text;
  t.clear();
  const name = basename(specFile);
  const { open, pending } = state.activeThreadCount();

  // Filename — bold
  t.add(TextNodeRenderable.fromString(` ${name}`, { fg: theme.text, attributes: TextAttributes.BOLD }));

  t.add(TextNodeRenderable.fromString("  \u00b7  ", { fg: theme.textDim }));

  // Thread summary
  if (open > 0 || pending > 0) {
    const parts: string[] = [];
    if (open > 0) parts.push(`${open} open`);
    if (pending > 0) parts.push(`${pending} pending`);
    t.add(TextNodeRenderable.fromString(parts.join(", "), { fg: theme.yellow }));
  } else {
    t.add(TextNodeRenderable.fromString("No active threads", { fg: theme.textMuted }));
  }

  // Unread replies
  if (unreadCount && unreadCount > 0) {
    t.add(TextNodeRenderable.fromString("  \u00b7  ", { fg: theme.textDim }));
    t.add(TextNodeRenderable.fromString(
      `${unreadCount} new repl${unreadCount === 1 ? "y" : "ies"}`,
      { fg: theme.green, attributes: TextAttributes.BOLD }
    ));
  }

  // Spec changed warning
  if (specChanged) {
    t.add(TextNodeRenderable.fromString("  \u00b7  ", { fg: theme.textDim }));
    t.add(TextNodeRenderable.fromString("!! Spec changed externally", { fg: theme.red, attributes: TextAttributes.BOLD }));
  }

  // Cursor position
  t.add(TextNodeRenderable.fromString("  \u00b7  ", { fg: theme.textDim }));
  t.add(TextNodeRenderable.fromString(`L${state.cursorLine}/${state.lineCount}`, { fg: theme.textMuted }));
}

/**
 * Set a transient message on the bottom bar (using TextNodes, not .content).
 */
export function setBottomBarMessage(bar: BottomBarComponents, message: string, fg?: string): void {
  const t = bar.text;
  t.clear();
  t.add(TextNodeRenderable.fromString(message, { fg: fg ?? theme.text }));
}

/**
 * Build the bottom bar with styled TextNodes.
 */
export function buildBottomBar(bar: BottomBarComponents, commandBuffer: string | null, hasThread?: boolean): void {
  const t = bar.text;
  t.clear();
  if (commandBuffer !== null) {
    t.add(TextNodeRenderable.fromString(` :${commandBuffer}`, { fg: theme.text }));
    return;
  }
  const hints: Hint[] = [
    { key: "j/k", action: "navigate" },
    { key: "c", action: "comment" },
  ];
  if (hasThread) {
    hints.push({ key: "r", action: "resolve" });
  }
  hints.push({ key: "S", action: "submit" });
  hints.push({ key: "?", action: "help" });
  buildHints(t, hints);
}

/**
 * Create the top status bar (BoxRenderable with backgroundColor for full-width fill).
 */
export function createTopBar(renderer: CliRenderer): TopBarComponents {
  const box = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    backgroundColor: theme.backgroundPanel,
  });

  const text = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    fg: theme.text,
    wrapMode: "none",
    truncate: true,
  });

  box.add(text);
  return { box, text };
}

/**
 * Create the bottom status bar.
 */
export function createBottomBar(renderer: CliRenderer): BottomBarComponents {
  const box = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
    backgroundColor: theme.backgroundPanel,
  });

  const text = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    fg: theme.text,
    wrapMode: "none",
    truncate: true,
  });

  box.add(text);
  return { box, text };
}

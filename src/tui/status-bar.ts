import { TextRenderable, type CliRenderer } from "@opentui/core";
import type { ReviewState } from "../state/review-state";
import { basename } from "path";

export interface TopBarComponents {
  bar: TextRenderable;
}

export interface BottomBarComponents {
  bar: TextRenderable;
}

/**
 * Build the top bar text: filename + thread summary.
 */
export function buildTopBarText(
  specFile: string,
  state: ReviewState
): string {
  const name = basename(specFile);
  const { open, pending } = state.activeThreadCount();
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} open`);
  if (pending > 0) parts.push(`${pending} pending`);
  const threadSummary =
    parts.length > 0 ? `Threads: ${parts.join(", ")}` : "No active threads";
  return ` ${name}  |  ${threadSummary}  |  L${state.cursorLine}/${state.lineCount}`;
}

/**
 * Build the bottom bar text: keybinding hints.
 * Contextually shows command buffer when in command mode.
 */
export function buildBottomBarText(commandBuffer: string | null, showHelp: boolean = false): string {
  if (commandBuffer !== null) {
    return ` :${commandBuffer}`;
  }
  if (showHelp) {
    return " j/k:move  Space/b:page  n/N:thread  c:comment  e:expand  l:list  /:search  r:resolve  R:resolve-all  d:delete  a:approve  :w:save  :q:submit  :q!:quit  ?:close";
  }
  return " j/k:move  c:comment  r:resolve  /:search  ?:help";
}

/**
 * Create the top status bar.
 */
export function createTopBar(renderer: CliRenderer): TopBarComponents {
  const bar = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    height: 1,
    bg: "#333333",
    fg: "#ffffff",
    wrapMode: "none",
    truncate: true,
  });

  return { bar };
}

/**
 * Create the bottom status bar.
 */
export function createBottomBar(renderer: CliRenderer): BottomBarComponents {
  const bar = new TextRenderable(renderer, {
    content: "",
    width: "100%",
    height: 1,
    bg: "#333333",
    fg: "#ffffff",
    wrapMode: "none",
    truncate: true,
  });

  return { bar };
}

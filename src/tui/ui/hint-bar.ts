import { TextRenderable, TextNodeRenderable, TextAttributes } from "@opentui/core";
import { theme } from "./theme";

export interface Hint {
  key: string;
  action: string;
}

export function buildHints(text: TextRenderable, hints: Hint[]): void {
  text.clear();
  text.add(TextNodeRenderable.fromString(" ", {}));
  for (let i = 0; i < hints.length; i++) {
    const h = hints[i];
    // Mode labels (empty action) get distinct styling so they stand out
    const isMode = h.action === "";
    const keyFg = isMode ? (h.key === "INSERT" ? theme.green : theme.blue) : theme.blue;
    const keyAttrs = isMode ? TextAttributes.BOLD : undefined;
    text.add(TextNodeRenderable.fromString(`[${h.key}]`, { fg: keyFg, attributes: keyAttrs }));
    if (!isMode) {
      text.add(TextNodeRenderable.fromString(` ${h.action}`, { fg: theme.textMuted }));
    }
    if (i < hints.length - 1) {
      text.add(TextNodeRenderable.fromString("  ", {}));
    }
  }
}

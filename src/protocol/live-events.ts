import { appendFileSync, readFileSync, existsSync } from "fs";
import type { Thread } from "./types";

export type LiveEventType =
  | "comment"
  | "reply"
  | "resolve"
  | "unresolve"
  | "approve"
  | "delete"
  | "round";

export interface LiveEvent {
  type: LiveEventType;
  threadId?: string;
  line?: number;
  author: string;
  text?: string;
  ts: number;
  round?: number;
}

const VALID_LIVE_EVENT_TYPES: readonly LiveEventType[] = [
  "comment",
  "reply",
  "resolve",
  "unresolve",
  "approve",
  "delete",
  "round",
];

export function isValidLiveEvent(value: unknown): value is LiveEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  // Must have a valid type
  if (
    typeof v.type !== "string" ||
    !VALID_LIVE_EVENT_TYPES.includes(v.type as LiveEventType)
  ) {
    return false;
  }

  // Must have a ts (timestamp)
  if (typeof v.ts !== "number") return false;

  // comment requires text and line
  if (v.type === "comment") {
    if (typeof v.text !== "string") return false;
    if (typeof v.line !== "number") return false;
  }

  return true;
}

export function appendEvent(jsonlPath: string, event: LiveEvent): void {
  appendFileSync(jsonlPath, JSON.stringify(event) + "\n", "utf8");
}

export function readEventsFromOffset(
  jsonlPath: string,
  offset: number
): { events: LiveEvent[]; newOffset: number } {
  if (!existsSync(jsonlPath)) {
    return { events: [], newOffset: 0 };
  }

  const buf = readFileSync(jsonlPath);
  if (buf.length <= offset) {
    return { events: [], newOffset: offset };
  }

  // Alignment safety: if we're mid-line, skip to next \n
  let startPos = offset;
  if (startPos > 0) {
    // Check if offset is at a line boundary (byte before offset is '\n', or offset is 0)
    const atLineBoundary = buf[startPos - 1] === 0x0a;
    if (!atLineBoundary) {
      // We're mid-line — scan forward to find the next newline
      let found = false;
      for (let i = startPos; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
          // '\n'
          startPos = i + 1;
          found = true;
          break;
        }
      }
      if (!found) {
        // No newline found after offset — nothing to read
        return { events: [], newOffset: buf.length };
      }
    }
    // else: we're at a line boundary, start reading from here
  }

  const slice = buf.slice(startPos).toString("utf8");
  const lines = slice.split("\n");
  const events: LiveEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isValidLiveEvent(parsed)) {
        events.push(parsed);
      }
      // else: discard malformed/invalid events
    } catch {
      // Discard malformed lines
    }
  }

  return { events, newOffset: buf.length };
}

export function replayEventsToThreads(events: LiveEvent[]): Thread[] {
  const threadsMap = new Map<string, Thread>();
  const threadOrder: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case "comment": {
        if (!event.threadId || typeof event.line !== "number" || !event.text)
          break;
        const thread: Thread = {
          id: event.threadId,
          line: event.line,
          status: "open",
          messages: [{ author: "reviewer", text: event.text, ts: event.ts }],
        };
        threadsMap.set(event.threadId, thread);
        threadOrder.push(event.threadId);
        break;
      }

      case "reply": {
        if (!event.threadId || !event.text) break;
        const thread = threadsMap.get(event.threadId);
        if (!thread) break;
        thread.messages.push({
          author: event.author as "reviewer" | "owner",
          text: event.text,
          ts: event.ts,
        });
        // Status based on author
        thread.status = event.author === "owner" ? "pending" : "open";
        break;
      }

      case "resolve": {
        if (!event.threadId) break;
        const thread = threadsMap.get(event.threadId);
        if (!thread) break;
        thread.status = "resolved";
        break;
      }

      case "unresolve": {
        if (!event.threadId) break;
        const thread = threadsMap.get(event.threadId);
        if (!thread) break;
        thread.status = "open";
        break;
      }

      case "delete": {
        if (!event.threadId) break;
        const thread = threadsMap.get(event.threadId);
        if (!thread) break;
        // Remove the last reviewer message
        for (let i = thread.messages.length - 1; i >= 0; i--) {
          if (thread.messages[i].author === "reviewer") {
            thread.messages.splice(i, 1);
            break;
          }
        }
        break;
      }

      case "approve":
      case "round":
        // Skip these event types
        break;
    }
  }

  // Return threads in order, excluding empty ones
  return threadOrder
    .map((id) => threadsMap.get(id)!)
    .filter((t) => t && t.messages.length > 0);
}

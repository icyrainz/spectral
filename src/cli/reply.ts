import { existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import {
  appendEvent,
  readEventsFromOffset,
} from "../protocol/live-events";

export function runReply(
  specFile: string,
  threadId: string,
  text: string
): void {
  // Resolve and validate spec path
  const specPath = resolve(specFile);
  if (!existsSync(specPath)) {
    console.error(`Error: Spec file not found: ${specPath}`);
    process.exit(1);
  }

  // Reject empty text
  if (!text || text.trim() === "") {
    console.error("Error: Reply text cannot be empty");
    process.exit(1);
  }

  // Derive JSONL path
  const dir = dirname(specPath);
  const base = basename(specPath, ".md");
  const jsonlPath = `${dir}/${base}.review.live.jsonl`;

  // Validate JSONL exists
  if (!existsSync(jsonlPath)) {
    console.error(`Error: JSONL file not found: ${jsonlPath}`);
    process.exit(1);
  }

  // Validate thread ID exists in JSONL
  const { events } = readEventsFromOffset(jsonlPath, 0);
  const threadExists = events.some((e) => e.threadId === threadId);
  if (!threadExists) {
    console.error(`Error: Thread ID not found: ${threadId}`);
    process.exit(1);
  }

  // Append reply event
  appendEvent(jsonlPath, {
    type: "reply",
    threadId,
    author: "owner",
    text,
    ts: Date.now(),
  });
}

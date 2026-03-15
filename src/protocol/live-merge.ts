import type { ReviewFile, Thread } from "./types";
import { readEventsFromOffset, replayEventsToThreads } from "./live-events";

/**
 * Merges a JSONL event log into an existing (or new) ReviewFile.
 * Always replays entire JSONL from byte 0 (idempotent).
 * - Existing review threads preserved
 * - JSONL threads merged by ID
 * - For existing thread IDs: append only new messages (by count), update status
 * - New thread IDs: add wholesale
 */
export function mergeJsonlIntoReview(
  jsonlPath: string,
  existingReview: ReviewFile | null,
  specFile: string
): ReviewFile {
  const base: ReviewFile = existingReview ?? { file: specFile, threads: [] };

  // Replay all JSONL events from byte 0
  const { events } = readEventsFromOffset(jsonlPath, 0);
  const jsonlThreads = replayEventsToThreads(events);

  if (jsonlThreads.length === 0) {
    // Nothing from JSONL — return existing unchanged
    return { ...base, threads: [...base.threads] };
  }

  // Index existing threads by ID
  const existingById = new Map<string, Thread>(
    base.threads.map((t) => [t.id, t])
  );

  // Build merged thread map starting from existing threads (deep copy messages)
  const mergedById = new Map<string, Thread>(
    base.threads.map((t) => [t.id, { ...t, messages: [...t.messages] }])
  );

  for (const jsonlThread of jsonlThreads) {
    const existing = existingById.get(jsonlThread.id);
    if (!existing) {
      // New thread from JSONL — add wholesale
      mergedById.set(jsonlThread.id, jsonlThread);
    } else {
      // Existing thread — append only new messages (by count), update status
      const existingCount = existing.messages.length;
      const newMessages = jsonlThread.messages.slice(existingCount);
      const merged = mergedById.get(jsonlThread.id)!;
      merged.messages.push(...newMessages);
      merged.status = jsonlThread.status;
    }
  }

  // Preserve original ordering of existing threads, then append new JSONL-only threads
  const orderedIds = [
    ...base.threads.map((t) => t.id),
    ...jsonlThreads
      .filter((t) => !existingById.has(t.id))
      .map((t) => t.id),
  ];

  const threads = orderedIds
    .filter((id) => mergedById.has(id))
    .map((id) => mergedById.get(id)!);

  return { ...base, threads };
}

import type { ReviewFile, DraftFile, Thread } from "./types";

export function mergeDraftIntoReview(
  review: ReviewFile | null,
  draft: DraftFile,
  specFile: string = ""
): ReviewFile {
  // Build a starting ReviewFile
  const base: ReviewFile = review ?? { file: specFile, threads: [] };

  // If draft has no threads, return review unchanged
  const draftThreads = draft.threads;
  if (!draftThreads || draftThreads.length === 0) {
    return { ...base, threads: [...base.threads] };
  }

  // Index existing threads by id for O(1) lookup
  const existingById = new Map<string, Thread>(
    base.threads.map((t) => [t.id, t])
  );

  const mergedById = new Map<string, Thread>(
    base.threads.map((t) => [t.id, { ...t, messages: [...t.messages] }])
  );

  for (const draftThread of draftThreads) {
    const existing = existingById.get(draftThread.id);
    if (!existing) {
      // New thread — add it wholesale
      mergedById.set(draftThread.id, draftThread);
    } else {
      // Existing thread — append only new messages (draft has full history)
      const existingCount = existing.messages.length;
      const newMessages = draftThread.messages.slice(existingCount);
      const merged = mergedById.get(draftThread.id)!;
      merged.messages.push(...newMessages);
      merged.status = draftThread.status;
    }
  }

  // Preserve original ordering of existing threads, then append new ones
  const orderedIds = [
    ...base.threads.map((t) => t.id),
    ...draftThreads
      .filter((t) => !existingById.has(t.id))
      .map((t) => t.id),
  ];

  const threads = orderedIds.map((id) => mergedById.get(id)!);

  return { ...base, threads };
}

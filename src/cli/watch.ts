import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { watch as fsWatch } from "fs";
import { resolve, dirname, basename, join } from "path";
import {
  readEventsFromOffset,
  type LiveEvent,
} from "../protocol/live-events";
import type { Thread } from "../protocol/types";
import { replayEventsToThreads } from "../protocol/live-events";

/** Atomic write: write to .tmp then rename (POSIX rename is atomic) */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, filePath);
}

export async function runWatch(specFile: string): Promise<void> {
  // Resolve and validate spec path
  const specPath = resolve(specFile);
  if (!existsSync(specPath)) {
    console.error(`Error: Spec file not found: ${specPath}`);
    process.exit(1);
  }

  // Derive paths
  const dir = dirname(specPath);
  const base = basename(specPath, ".md");
  const jsonlPath = join(dir, `${base}.review.jsonl`);
  const offsetPath = join(dir, `${base}.review.offset`);
  const lockPath = join(dir, `${base}.review.lock`);

  // Handle lock file
  if (existsSync(lockPath)) {
    const lockContent = readFileSync(lockPath, "utf8").trim();
    const lockedPid = parseInt(lockContent, 10);
    if (!isNaN(lockedPid) && lockedPid !== process.pid) {
      // Check if the PID is alive
      const pidAlive = isPidAlive(lockedPid);
      if (pidAlive) {
        console.error(
          `Error: Another revspec watch is running (PID ${lockedPid})`
        );
        process.exit(3);
      } else {
        // Stale lock — delete and proceed
        unlinkSync(lockPath);
      }
    }
  }

  // Create/overwrite lock with current PID
  writeFileSync(lockPath, String(process.pid), "utf8");

  // Read offset and last processed submit timestamp from offset file
  let offset = 0;
  let lastSubmitTs = 0;
  if (existsSync(offsetPath)) {
    const lines = readFileSync(offsetPath, "utf8").trim().split("\n");
    const parsed = parseInt(lines[0], 10);
    if (!isNaN(parsed)) {
      offset = parsed;
    }
    if (lines.length > 1) {
      const parsedTs = parseInt(lines[1], 10);
      if (!isNaN(parsedTs)) {
        lastSubmitTs = parsedTs;
      }
    }
  }

  // Read spec lines for context
  const specLines = readFileSync(specPath, "utf8").split("\n");

  const noBlock = process.env.REVSPEC_WATCH_NO_BLOCK === "1";

  if (noBlock) {
    // Non-blocking mode: process events immediately, output, exit
    const result = processNewEvents(
      jsonlPath,
      offsetPath,
      specPath,
      specLines,
      offset,
      lastSubmitTs,
      true // always check recovery in non-blocking (one-shot)
    );
    if (result.approved) {
      console.log("Review approved.");
      cleanupFiles(lockPath, offsetPath);
    } else if (result.output) {
      process.stdout.write(result.output);
    }
    return;
  }

  // Blocking mode: watch for JSONL changes
  let processing = false;
  let firstPoll = true; // only run crash recovery on first poll

  const handleChange = () => {
    if (processing) return;
    processing = true;
    try {
      const result = processNewEvents(
        jsonlPath,
        offsetPath,
        specPath,
        specLines,
        offset,
        lastSubmitTs,
        firstPoll
      );
      firstPoll = false;

      if (result.approved) {
        console.log("Review approved.");
        cleanupFiles(lockPath, offsetPath);
        process.exit(0);
      }

      if (result.output) {
        process.stdout.write(result.output);
        // Exit after outputting — AI re-spawns for the next batch
        process.exit(0);
      }

      // Update state for next poll iteration
      offset = result.newOffset;
      if (existsSync(offsetPath)) {
        const lines = readFileSync(offsetPath, "utf8").trim().split("\n");
        if (lines.length > 1) {
          const parsedTs = parseInt(lines[1], 10);
          if (!isNaN(parsedTs)) lastSubmitTs = parsedTs;
        }
      }
    } finally {
      processing = false;
    }
  };

  // Polling fallback (500ms interval)
  const pollInterval = setInterval(handleChange, 500);

  // Try to use fs.watch on the JSONL file (may not exist yet)
  let watcher: ReturnType<typeof fsWatch> | null = null;

  const setupWatcher = () => {
    if (existsSync(jsonlPath) && !watcher) {
      watcher = fsWatch(jsonlPath, () => {
        handleChange();
      });
    }
  };

  setupWatcher();

  // Also watch the directory for the JSONL file to appear
  const dirWatcher = fsWatch(dir, (eventType, filename) => {
    if (filename && filename.endsWith(".jsonl")) {
      setupWatcher();
    }
  });

  // Cleanup on exit
  process.on("exit", () => {
    clearInterval(pollInterval);
    if (watcher) watcher.close();
    dirWatcher.close();
    if (existsSync(lockPath)) {
      const content = readFileSync(lockPath, "utf8").trim();
      if (content === String(process.pid)) {
        unlinkSync(lockPath);
      }
    }
  });

  // Keep process alive
  await new Promise<void>(() => {
    // Never resolves — process runs until exit signal
  });
}

interface ProcessResult {
  approved: boolean;
  output: string;
  newOffset: number;
}

function processNewEvents(
  jsonlPath: string,
  offsetPath: string,
  specPath: string,
  specLines: string[],
  offset: number,
  lastSubmitTs: number,
  checkRecovery: boolean
): ProcessResult {
  if (!existsSync(jsonlPath)) {
    return { approved: false, output: "", newOffset: offset };
  }

  const { events, newOffset } = readEventsFromOffset(jsonlPath, offset);

  // Recovery: detect pending unprocessed submit (only on first poll to avoid
  // re-reading the entire JSONL every 500ms in blocking mode)
  if (events.length === 0 && checkRecovery) {
    const { events: allEvents } = readEventsFromOffset(jsonlPath, 0);
    const lastSubmitIdx = allEvents.findLastIndex(e => e.type === "submit");
    if (lastSubmitIdx >= 0) {
      const lastSubmitEvent = allEvents[lastSubmitIdx];
      // If we already output this submit, skip (not a crash)
      if (lastSubmitEvent.ts === lastSubmitTs) {
        return { approved: false, output: "", newOffset: offset };
      }
      const afterSubmit = allEvents.slice(lastSubmitIdx + 1);
      const hasNewActivity = afterSubmit.some(e =>
        e.type === "comment" || e.type === "reply" ||
        e.type === "approve" || e.type === "session-end"
      );
      if (!hasNewActivity) {
        const roundStart = findCurrentRoundStartIndex(allEvents);
        const currentRoundThreads = replayEventsToThreads(allEvents.slice(roundStart));
        const resolved = currentRoundThreads.filter(t => t.status === "resolved");
        const output = formatSubmitOutput(resolved, specPath);
        // Record this submit's ts so we don't re-output it
        atomicWriteFileSync(offsetPath, `${offset}\n${lastSubmitEvent.ts}`);
        return { approved: false, output, newOffset: offset };
      }
    }
    return { approved: false, output: "", newOffset: offset };
  }

  if (events.length === 0) {
    return { approved: false, output: "", newOffset: offset };
  }

  // Save new offset
  atomicWriteFileSync(offsetPath, String(newOffset));

  // Check for approve event
  const hasApprove = events.some((e) => e.type === "approve");
  if (hasApprove) {
    return { approved: true, output: "", newOffset };
  }

  // Check for submit event — priority over session-end
  const submitEvent = events.findLast((e) => e.type === "submit");
  if (submitEvent) {
    const { events: allEvents } = readEventsFromOffset(jsonlPath, 0);
    const roundStart = findCurrentRoundStartIndex(allEvents);
    const currentRoundThreads = replayEventsToThreads(allEvents.slice(roundStart));
    const resolved = currentRoundThreads.filter(t => t.status === "resolved");
    const output = formatSubmitOutput(resolved, specPath);
    // Record submit ts for crash recovery dedup
    atomicWriteFileSync(offsetPath, `${newOffset}\n${submitEvent.ts}`);
    return { approved: false, output, newOffset };
  }

  // Check for session-end — TUI exited, break the loop
  const hasSessionEnd = events.some((e) => e.type === "session-end");
  if (hasSessionEnd) {
    return { approved: false, output: "Session ended. Reviewer exited revspec.\n", newOffset };
  }

  // Only return actionable events — comments and replies that need an LLM response.
  // Resolves, unresolves, and deletes are informational — no reply needed.
  const actionableEvents = events.filter(
    (e) => e.author === "reviewer" && (e.type === "comment" || e.type === "reply")
  );

  if (actionableEvents.length === 0) {
    return { approved: false, output: "", newOffset };
  }

  // Read all events from start to build full thread history
  const { events: allEvents } = readEventsFromOffset(jsonlPath, 0);
  const allThreads = replayEventsToThreads(allEvents);
  const threadsById = new Map(allThreads.map((t) => [t.id, t]));

  const output = formatWatchOutput(
    actionableEvents,
    threadsById,
    specLines,
    specPath
  );

  return { approved: false, output, newOffset };
}

function formatWatchOutput(
  events: LiveEvent[],
  threadsById: Map<string, Thread>,
  specLines: string[],
  specPath: string
): string {
  // Group events by type
  const newCommentThreadIds: string[] = [];
  const replyThreadIds: string[] = [];

  const seen = new Set<string>();

  for (const event of events) {
    if (!event.threadId) continue;
    const tid = event.threadId;

    if (event.type === "comment" && !seen.has(tid)) {
      newCommentThreadIds.push(tid);
      seen.add(tid);
    } else if (event.type === "reply") {
      if (!replyThreadIds.includes(tid)) {
        replyThreadIds.push(tid);
      }
    }
  }

  const lines: string[] = [];

  // New threads
  if (newCommentThreadIds.length > 0) {
    lines.push("=== New Comments ===");
    for (const tid of newCommentThreadIds) {
      const thread = threadsById.get(tid);
      if (!thread) continue;

      lines.push(`Thread: ${tid} (line ${thread.line})`);

      // Include 2 lines of context around the anchored line
      const contextLines = getContext(specLines, thread.line, 2);
      if (contextLines.length > 0) {
        lines.push("  Context:");
        for (const cl of contextLines) {
          lines.push(`    ${cl}`);
        }
      }

      // Show messages
      for (const msg of thread.messages) {
        lines.push(`  [${msg.author}]: ${msg.text}`);
      }

      // Reply instruction
      lines.push(
        `  To reply: revspec reply ${specPath} ${tid} "<your reply>"`
      );
      lines.push("");
    }
  }

  // Replies (threads with new replies)
  if (replyThreadIds.length > 0) {
    lines.push("=== Replies ===");
    for (const tid of replyThreadIds) {
      const thread = threadsById.get(tid);
      if (!thread) continue;

      lines.push(`Thread: ${tid} (line ${thread.line})`);

      // Full thread history
      for (const msg of thread.messages) {
        lines.push(`  [${msg.author}]: ${msg.text}`);
      }

      // Reply instruction
      lines.push(
        `  To reply: revspec reply ${specPath} ${tid} "<your reply>"`
      );
      lines.push("");
    }
  }

  // Add footer instruction
  const hasActionable = newCommentThreadIds.length > 0 || replyThreadIds.length > 0;
  if (hasActionable) {
    lines.push(`When done replying, run: revspec watch ${basename(specPath)}`);
    lines.push("");
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function getContext(
  specLines: string[],
  lineNumber: number,
  contextSize: number
): string[] {
  // lineNumber is 1-based
  const idx = lineNumber - 1;
  const start = Math.max(0, idx - contextSize);
  const end = Math.min(specLines.length - 1, idx + contextSize);

  const result: string[] = [];
  for (let i = start; i <= end; i++) {
    const prefix = i === idx ? ">" : " ";
    result.push(`${prefix} ${i + 1}: ${specLines[i]}`);
  }
  return result;
}

function findCurrentRoundStartIndex(events: LiveEvent[]): number {
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "submit") {
      count++;
      if (count === 2) return i + 1;
    }
  }
  return 0;
}

function formatSubmitOutput(
  resolvedThreads: Thread[],
  specPath: string
): string {
  const lines: string[] = [];
  lines.push("=== Submit: Rewrite Requested ===");
  lines.push("");
  if (resolvedThreads.length > 0) {
    lines.push("Resolved threads:");
    for (const t of resolvedThreads) {
      const reviewerMsgs = t.messages.filter(m => m.author === "reviewer");
      const ownerMsgs = t.messages.filter(m => m.author === "owner");
      lines.push(`  ${t.id} (line ${t.line}): "${reviewerMsgs.map(m => m.text).join("; ")}"`);
      if (ownerMsgs.length > 0) {
        lines.push(`    → AI: "${ownerMsgs.map(m => m.text).join("; ")}"`);
      }
    }
    lines.push("");
  }
  lines.push(`Rewrite the spec incorporating the above, then run: revspec watch ${basename(specPath)}`);
  lines.push("");
  return lines.join("\n");
}

function cleanupFiles(lockPath: string, offsetPath: string): void {
  if (existsSync(lockPath)) unlinkSync(lockPath);
  if (existsSync(offsetPath)) unlinkSync(offsetPath);
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

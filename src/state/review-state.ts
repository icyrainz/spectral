import { randomBytes } from "crypto";
import type { Thread, Message } from "../protocol/types";

function nanoid(size = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

export class ReviewState {
  specLines: string[];
  threads: Thread[];
  cursorLine: number = 1;
  private _unreadThreadIds: Set<string> = new Set();

  get unreadThreadIds(): ReadonlySet<string> {
    return this._unreadThreadIds;
  }

  constructor(specLines: string[], threads: Thread[]) {
    this.specLines = specLines;
    this.threads = threads;
  }

  get lineCount(): number {
    return this.specLines.length;
  }

  nextThreadId(): string {
    return nanoid();
  }

  addComment(line: number, text: string): void {
    const thread: Thread = {
      id: this.nextThreadId(),
      line,
      status: "open",
      messages: [{ author: "reviewer", text, ts: Date.now() }],
    };
    this.threads.push(thread);
  }

  replyToThread(threadId: string, text: string): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.messages.push({ author: "reviewer", text, ts: Date.now() });
    thread.status = "open";
  }

  resolveThread(threadId: string): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    // Toggle: resolved → open, anything else → resolved
    if (thread.status === "resolved") {
      thread.status = "open";
    } else {
      thread.status = "resolved";
    }
  }

  resolveAllPending(): void {
    for (const thread of this.threads) {
      if (thread.status === "pending") {
        thread.status = "resolved";
      }
    }
  }

  resolveAll(): void {
    for (const thread of this.threads) {
      if (thread.status !== "resolved" && thread.status !== "outdated") {
        thread.status = "resolved";
      }
    }
  }

  reset(newSpecLines: string[]): void {
    this.specLines = newSpecLines;
    this.threads = [];
    this.cursorLine = 1;
    this._unreadThreadIds.clear();
  }

  threadAtLine(line: number): Thread | null {
    return this.threads.find((t) => t.line === line) ?? null;
  }

  nextThread(): number | null {
    if (this.threads.length === 0) return null;

    const after = this.threads.filter((t) => t.line > this.cursorLine);
    if (after.length > 0) {
      return after.reduce((min, t) => (t.line < min.line ? t : min)).line;
    }

    // Wrap: return the lowest-line thread
    return this.threads.reduce((min, t) => (t.line < min.line ? t : min)).line;
  }

  prevThread(): number | null {
    if (this.threads.length === 0) return null;

    const before = this.threads.filter((t) => t.line < this.cursorLine);
    if (before.length > 0) {
      return before.reduce((max, t) => (t.line > max.line ? t : max)).line;
    }

    // Wrap: return the highest-line thread
    return this.threads.reduce((max, t) => (t.line > max.line ? t : max)).line;
  }

  nextHeading(level: number): number | null {
    const prefix = "#".repeat(level) + " ";
    const guard = "#".repeat(level + 1);
    for (let i = this.cursorLine; i < this.specLines.length; i++) {
      const line = this.specLines[i];
      if (line.startsWith(prefix) && !line.startsWith(guard)) return i + 1;
    }
    // Wrap: search from top
    for (let i = 0; i < this.cursorLine - 1; i++) {
      const line = this.specLines[i];
      if (line.startsWith(prefix) && !line.startsWith(guard)) return i + 1;
    }
    return null;
  }

  prevHeading(level: number): number | null {
    const prefix = "#".repeat(level) + " ";
    const guard = "#".repeat(level + 1);
    for (let i = this.cursorLine - 2; i >= 0; i--) {
      const line = this.specLines[i];
      if (line.startsWith(prefix) && !line.startsWith(guard)) return i + 1;
    }
    // Wrap: search from bottom
    for (let i = this.specLines.length - 1; i >= this.cursorLine; i--) {
      const line = this.specLines[i];
      if (line.startsWith(prefix) && !line.startsWith(guard)) return i + 1;
    }
    return null;
  }

  canApprove(): boolean {
    // No threads = clean approval (spec is good as-is)
    if (this.threads.length === 0) return true;
    return this.threads.every(
      (t) => t.status === "resolved" || t.status === "outdated"
    );
  }

  activeThreadCount(): { open: number; pending: number } {
    let open = 0;
    let pending = 0;
    for (const t of this.threads) {
      if (t.status === "open") open++;
      else if (t.status === "pending") pending++;
    }
    return { open, pending };
  }

  deleteLastDraftMessage(threadId: string): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;

    // Find and remove the last human message
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (thread.messages[i].author === "reviewer") {
        thread.messages.splice(i, 1);
        break;
      }
    }

    // Remove thread entirely if now empty
    if (thread.messages.length === 0) {
      this.threads = this.threads.filter((t) => t.id !== threadId);
    }
  }

  deleteThread(threadId: string): void {
    this.threads = this.threads.filter((t) => t.id !== threadId);
    this._unreadThreadIds.delete(threadId);
  }

  addOwnerReply(threadId: string, text: string, ts?: number): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    const msg: Message = { author: "owner", text };
    if (ts !== undefined) msg.ts = ts;
    thread.messages.push(msg);
    thread.status = "pending";
    this._unreadThreadIds.add(threadId);
  }

  unreadCount(): number {
    return this._unreadThreadIds.size;
  }

  isThreadUnread(threadId: string): boolean {
    return this._unreadThreadIds.has(threadId);
  }

  markRead(threadId: string): void {
    this._unreadThreadIds.delete(threadId);
  }

  nextUnreadThread(): number | null {
    const unreadThreads = this.threads.filter((t) => this._unreadThreadIds.has(t.id));
    const after = unreadThreads.find((t) => t.line > this.cursorLine);
    if (after) return after.line;
    return unreadThreads.length > 0 ? unreadThreads[0].line : null;
  }

  prevUnreadThread(): number | null {
    const unreadThreads = this.threads.filter((t) => this._unreadThreadIds.has(t.id));
    const before = [...unreadThreads].reverse().find((t) => t.line < this.cursorLine);
    if (before) return before.line;
    return unreadThreads.length > 0 ? unreadThreads[unreadThreads.length - 1].line : null;
  }

  toDraft(): { threads: Thread[] } {
    return { threads: this.threads };
  }
}

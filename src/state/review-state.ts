import type { Thread } from "../protocol/types";

export class ReviewState {
  specLines: string[];
  threads: Thread[];
  cursorLine: number = 1;

  constructor(specLines: string[], threads: Thread[]) {
    this.specLines = specLines;
    this.threads = threads;
  }

  get lineCount(): number {
    return this.specLines.length;
  }

  nextThreadId(): string {
    if (this.threads.length === 0) return "t1";
    const highest = this.threads.reduce((max, t) => {
      const n = parseInt(t.id.replace(/^t/, ""), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return `t${highest + 1}`;
  }

  addComment(line: number, text: string): void {
    const thread: Thread = {
      id: this.nextThreadId(),
      line,
      status: "open",
      messages: [{ author: "human", text }],
    };
    this.threads.push(thread);
  }

  replyToThread(threadId: string, text: string): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.messages.push({ author: "human", text });
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

  threadAtLine(line: number): Thread | null {
    return this.threads.find((t) => t.line === line) ?? null;
  }

  nextActiveThread(): number | null {
    const active = this.threads.filter(
      (t) => t.status === "open" || t.status === "pending"
    );
    if (active.length === 0) return null;

    // Look for first active thread after cursor (strictly after)
    const after = active.filter((t) => t.line > this.cursorLine);
    if (after.length > 0) {
      return after.reduce((min, t) => (t.line < min.line ? t : min)).line;
    }

    // Wrap: return the lowest-line active thread
    return active.reduce((min, t) => (t.line < min.line ? t : min)).line;
  }

  prevActiveThread(): number | null {
    const active = this.threads.filter(
      (t) => t.status === "open" || t.status === "pending"
    );
    if (active.length === 0) return null;

    // Look for last active thread before cursor (strictly before)
    const before = active.filter((t) => t.line < this.cursorLine);
    if (before.length > 0) {
      return before.reduce((max, t) => (t.line > max.line ? t : max)).line;
    }

    // Wrap: return the highest-line active thread
    return active.reduce((max, t) => (t.line > max.line ? t : max)).line;
  }

  canApprove(): boolean {
    if (this.threads.length === 0) return false;
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
      if (thread.messages[i].author === "human") {
        thread.messages.splice(i, 1);
        break;
      }
    }

    // Remove thread entirely if now empty
    if (thread.messages.length === 0) {
      this.threads = this.threads.filter((t) => t.id !== threadId);
    }
  }

  toDraft(): { threads: Thread[] } {
    return { threads: this.threads };
  }
}

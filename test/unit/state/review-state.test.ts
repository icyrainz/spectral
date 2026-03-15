import { describe, expect, it, beforeEach } from "bun:test";
import { ReviewState } from "../../../src/state/review-state";
import type { Thread } from "../../../src/protocol/types";

const SPEC = ["line one", "line two", "line three", "line four", "line five"];

function makeThread(
  id: string,
  line: number,
  status: Thread["status"],
  messages: Thread["messages"] = [{ author: "reviewer", text: "comment" }]
): Thread {
  return { id, line, status, messages };
}

describe("ReviewState", () => {
  describe("initializes with spec lines and no threads", () => {
    it("sets lineCount from specLines", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.lineCount).toBe(5);
    });

    it("starts cursor at line 1", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.cursorLine).toBe(1);
    });

    it("starts with empty threads array", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.threads).toHaveLength(0);
    });
  });

  describe("addComment", () => {
    it("adds a new thread with status open", () => {
      const state = new ReviewState(SPEC, []);
      state.addComment(3, "needs clarification");
      expect(state.threads).toHaveLength(1);
      expect(state.threads[0].line).toBe(3);
      expect(state.threads[0].status).toBe("open");
      expect(state.threads[0].messages).toHaveLength(1);
      expect(state.threads[0].messages[0].author).toBe("reviewer");
      expect(state.threads[0].messages[0].text).toBe("needs clarification");
      expect(state.threads[0].messages[0].ts).toBeGreaterThan(0);
    });

    it("assigns unique random id", () => {
      const state = new ReviewState(SPEC, []);
      state.addComment(1, "first");
      state.addComment(2, "second");
      expect(state.threads[0].id).not.toBe(state.threads[1].id);
      expect(state.threads[0].id.length).toBeGreaterThan(4);
    });
  });

  describe("replyToThread", () => {
    it("appends human message to existing thread", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 2, "pending")]);
      state.replyToThread("t1", "my reply");
      expect(state.threads[0].messages).toHaveLength(2);
      expect(state.threads[0].messages[1].author).toBe("reviewer");
      expect(state.threads[0].messages[1].text).toBe("my reply");
      expect(state.threads[0].messages[1].ts).toBeGreaterThan(0);
    });

    it("flips status to open", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 2, "pending")]);
      state.replyToThread("t1", "my reply");
      expect(state.threads[0].status).toBe("open");
    });

    it("does nothing for unknown threadId", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 2, "pending")]);
      state.replyToThread("t99", "ghost reply");
      expect(state.threads[0].messages).toHaveLength(1);
    });
  });

  describe("resolveThread", () => {
    it("sets thread status to resolved", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 1, "open")]);
      state.resolveThread("t1");
      expect(state.threads[0].status).toBe("resolved");
    });

    it("toggles resolved thread back to open", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 1, "resolved")]);
      state.resolveThread("t1");
      expect(state.threads[0].status).toBe("open");
    });

    it("does nothing for unknown threadId", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 1, "open")]);
      state.resolveThread("t99");
      expect(state.threads[0].status).toBe("open");
    });
  });

  describe("resolveAllPending", () => {
    it("resolves all pending threads", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "pending"),
        makeThread("t2", 2, "pending"),
        makeThread("t3", 3, "open"),
      ]);
      state.resolveAllPending();
      expect(state.threads[0].status).toBe("resolved");
      expect(state.threads[1].status).toBe("resolved");
    });

    it("leaves open threads unchanged", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "pending"),
        makeThread("t2", 2, "open"),
      ]);
      state.resolveAllPending();
      expect(state.threads[1].status).toBe("open");
    });
  });

  describe("threadAtLine", () => {
    it("returns thread when found", () => {
      const thread = makeThread("t1", 3, "open");
      const state = new ReviewState(SPEC, [thread]);
      expect(state.threadAtLine(3)).toEqual(thread);
    });

    it("returns null when not found", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 3, "open")]);
      expect(state.threadAtLine(5)).toBeNull();
    });
  });

  describe("nextThread", () => {
    it("returns next open/pending thread line after cursor", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 2, "open"),
        makeThread("t2", 4, "pending"),
      ]);
      state.cursorLine = 3;
      expect(state.nextThread()).toBe(4);
    });

    it("wraps around to first active thread when none after cursor", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "open"),
        makeThread("t2", 3, "pending"),
      ]);
      state.cursorLine = 4;
      expect(state.nextThread()).toBe(1);
    });

    it("includes resolved threads", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 2, "resolved"),
        makeThread("t2", 4, "open"),
      ]);
      state.cursorLine = 1;
      expect(state.nextThread()).toBe(2);
    });

    it("returns null when no threads", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.nextThread()).toBeNull();
    });
  });

  describe("prevThread", () => {
    it("returns previous thread line before cursor", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "open"),
        makeThread("t2", 3, "pending"),
      ]);
      state.cursorLine = 4;
      expect(state.prevThread()).toBe(3);
    });

    it("wraps around to last thread when none before cursor", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 2, "open"),
        makeThread("t2", 4, "pending"),
      ]);
      state.cursorLine = 1;
      expect(state.prevThread()).toBe(4);
    });

    it("includes resolved threads", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "open"),
        makeThread("t2", 3, "resolved"),
      ]);
      state.cursorLine = 5;
      expect(state.prevThread()).toBe(3);
    });

    it("returns null when no threads", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.prevThread()).toBeNull();
    });
  });

  describe("canApprove", () => {
    it("returns true when all threads are resolved", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "resolved"),
        makeThread("t2", 2, "resolved"),
      ]);
      expect(state.canApprove()).toBe(true);
    });

    it("returns true when threads are resolved or outdated", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "resolved"),
        makeThread("t2", 2, "outdated"),
      ]);
      expect(state.canApprove()).toBe(true);
    });

    it("returns false when any thread is open", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "resolved"),
        makeThread("t2", 2, "open"),
      ]);
      expect(state.canApprove()).toBe(false);
    });

    it("returns false when any thread is pending", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "resolved"),
        makeThread("t2", 2, "pending"),
      ]);
      expect(state.canApprove()).toBe(false);
    });

    it("returns true when there are no threads (clean approval)", () => {
      const state = new ReviewState(SPEC, []);
      expect(state.canApprove()).toBe(true);
    });
  });

  describe("nextThreadId", () => {
    it("returns a random string", () => {
      const state = new ReviewState(SPEC, []);
      const id = state.nextThreadId();
      expect(id.length).toBe(8);
      expect(/^[0-9a-z]+$/.test(id)).toBe(true);
    });

    it("returns unique IDs on consecutive calls", () => {
      const state = new ReviewState(SPEC, []);
      const ids = new Set(Array.from({ length: 10 }, () => state.nextThreadId()));
      expect(ids.size).toBe(10);
    });
  });

  describe("resolveAll", () => {
    it("resolves all open and pending threads", () => {
      const state = new ReviewState(SPEC, [
        makeThread("x1", 1, "open"),
        makeThread("x2", 2, "pending"),
        makeThread("x3", 3, "resolved"),
      ]);
      state.resolveAll();
      expect(state.threads[0].status).toBe("resolved");
      expect(state.threads[1].status).toBe("resolved");
      expect(state.threads[2].status).toBe("resolved");
    });

    it("does not change outdated threads", () => {
      const state = new ReviewState(SPEC, [makeThread("x1", 1, "outdated")]);
      state.resolveAll();
      expect(state.threads[0].status).toBe("outdated");
    });
  });

  describe("reset", () => {
    it("clears threads and reloads spec lines", () => {
      const state = new ReviewState(["a", "b"], [
        makeThread("x1", 1, "open"),
      ]);
      state.cursorLine = 2;
      state.reset(["c", "d", "e"]);
      expect(state.threads).toEqual([]);
      expect(state.specLines).toEqual(["c", "d", "e"]);
      expect(state.cursorLine).toBe(1);
      expect(state.lineCount).toBe(3);
    });

    it("clears unread tracking", () => {
      const state = new ReviewState(["a"], []);
      state.addComment(1, "fix");
      const id = state.threads[0].id;
      state.addOwnerReply(id, "done", 1001);
      expect(state.unreadCount()).toBe(1);
      state.reset(["b"]);
      expect(state.unreadCount()).toBe(0);
    });
  });

  describe("deleteLastDraftMessage", () => {
    it("removes the last human message from the thread", () => {
      const state = new ReviewState(SPEC, [
        {
          id: "t1",
          line: 1,
          status: "open",
          messages: [
            { author: "owner", text: "AI response" },
            { author: "reviewer", text: "my draft" },
          ],
        },
      ]);
      state.deleteLastDraftMessage("t1");
      expect(state.threads[0].messages).toHaveLength(1);
      expect(state.threads[0].messages[0].author).toBe("owner");
    });

    it("removes the thread entirely when it becomes empty", () => {
      const state = new ReviewState(SPEC, [
        {
          id: "t1",
          line: 1,
          status: "open",
          messages: [{ author: "reviewer", text: "only message" }],
        },
      ]);
      state.deleteLastDraftMessage("t1");
      expect(state.threads).toHaveLength(0);
    });

    it("does nothing for unknown threadId", () => {
      const state = new ReviewState(SPEC, [makeThread("t1", 1, "open")]);
      state.deleteLastDraftMessage("t99");
      expect(state.threads).toHaveLength(1);
      expect(state.threads[0].messages).toHaveLength(1);
    });
  });

  describe("toDraft", () => {
    it("serializes current threads", () => {
      const threads = [makeThread("t1", 2, "open")];
      const state = new ReviewState(SPEC, threads);
      expect(state.toDraft()).toEqual({ threads });
    });
  });

  describe("activeThreadCount", () => {
    it("counts open and pending threads separately", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "open"),
        makeThread("t2", 2, "pending"),
        makeThread("t3", 3, "open"),
        makeThread("t4", 4, "resolved"),
      ]);
      expect(state.activeThreadCount()).toEqual({ open: 2, pending: 1 });
    });

    it("returns zeros when no active threads", () => {
      const state = new ReviewState(SPEC, [
        makeThread("t1", 1, "resolved"),
        makeThread("t2", 2, "outdated"),
      ]);
      expect(state.activeThreadCount()).toEqual({ open: 0, pending: 0 });
    });
  });

  describe("unread tracking", () => {
    it("tracks unread owner replies", () => {
      const state = new ReviewState(["line1", "line2"], []);
      state.addComment(1, "fix this");
      const id = state.threads[0].id;
      state.addOwnerReply(id, "done", 1001);
      expect(state.unreadCount()).toBe(1);
    });

    it("markRead clears unread for a thread", () => {
      const state = new ReviewState(["line1"], []);
      state.addComment(1, "fix");
      const id = state.threads[0].id;
      state.addOwnerReply(id, "done", 1001);
      state.markRead(id);
      expect(state.unreadCount()).toBe(0);
    });

    it("nextUnreadThread returns line of next unread thread after cursor", () => {
      const state = new ReviewState(["a", "b", "c", "d", "e"], []);
      state.addComment(2, "fix");
      state.addComment(4, "fix too");
      const id1 = state.threads[0].id;
      const id2 = state.threads[1].id;
      state.addOwnerReply(id1, "done", 1001);
      state.addOwnerReply(id2, "done", 1002);
      state.cursorLine = 1;
      expect(state.nextUnreadThread()).toBe(2);
    });

    it("prevUnreadThread returns line of prev unread thread before cursor", () => {
      const state = new ReviewState(["a", "b", "c", "d", "e"], []);
      state.addComment(2, "fix");
      state.addComment(4, "fix too");
      const id1 = state.threads[0].id;
      const id2 = state.threads[1].id;
      state.addOwnerReply(id1, "done", 1001);
      state.addOwnerReply(id2, "done", 1002);
      state.cursorLine = 5;
      expect(state.prevUnreadThread()).toBe(4);
    });

    it("nextUnreadThread returns null when no unread", () => {
      const state = new ReviewState(["a"], []);
      expect(state.nextUnreadThread()).toBeNull();
    });

    it("isThreadUnread returns correct state", () => {
      const state = new ReviewState(["a"], []);
      state.addComment(1, "fix");
      const id = state.threads[0].id;
      expect(state.isThreadUnread(id)).toBe(false);
      state.addOwnerReply(id, "done", 1001);
      expect(state.isThreadUnread(id)).toBe(true);
      state.markRead(id);
      expect(state.isThreadUnread(id)).toBe(false);
    });

    it("nextUnreadThread wraps around", () => {
      const state = new ReviewState(["a", "b", "c", "d", "e"], []);
      state.addComment(2, "fix");
      const id = state.threads[0].id;
      state.addOwnerReply(id, "done", 1001);
      state.cursorLine = 4;
      expect(state.nextUnreadThread()).toBe(2);
    });

    it("addOwnerReply sets thread status to pending", () => {
      const state = new ReviewState(["a"], []);
      state.addComment(1, "fix");
      const id = state.threads[0].id;
      expect(state.threads[0].status).toBe("open");
      state.addOwnerReply(id, "done", 1001);
      expect(state.threads[0].status).toBe("pending");
    });

    it("addOwnerReply preserves timestamp on message", () => {
      const state = new ReviewState(["a"], []);
      state.addComment(1, "fix");
      const id = state.threads[0].id;
      state.addOwnerReply(id, "done", 1234567890);
      expect(state.threads[0].messages[1].ts).toBe(1234567890);
    });
  });
});

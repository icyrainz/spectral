import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  isValidLiveEvent,
  appendEvent,
  readEventsFromOffset,
  replayEventsToThreads,
  type LiveEvent,
} from "../../src/protocol/live-events";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "revspec-test-"));
}

describe("isValidLiveEvent", () => {
  it("accepts a valid comment event", () => {
    const event: unknown = {
      type: "comment",
      threadId: "t1",
      line: 5,
      author: "reviewer",
      text: "Hello",
      ts: 1000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid reply event", () => {
    const event: unknown = {
      type: "reply",
      threadId: "t1",
      author: "owner",
      text: "Thanks",
      ts: 2000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid resolve event", () => {
    const event: unknown = {
      type: "resolve",
      threadId: "t1",
      author: "reviewer",
      ts: 3000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid approve event", () => {
    const event: unknown = {
      type: "approve",
      author: "reviewer",
      ts: 4000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid round event", () => {
    const event: unknown = {
      type: "round",
      author: "owner",
      round: 2,
      ts: 5000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid delete event", () => {
    const event: unknown = {
      type: "delete",
      threadId: "t1",
      author: "reviewer",
      ts: 6000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("accepts a valid unresolve event", () => {
    const event: unknown = {
      type: "unresolve",
      threadId: "t1",
      author: "reviewer",
      ts: 7000,
    };
    expect(isValidLiveEvent(event)).toBe(true);
  });

  it("rejects event missing type", () => {
    expect(isValidLiveEvent({ author: "reviewer", ts: 1000 })).toBe(false);
  });

  it("rejects event with invalid type", () => {
    expect(
      isValidLiveEvent({ type: "invalid", author: "reviewer", ts: 1000 })
    ).toBe(false);
  });

  it("rejects comment missing text", () => {
    expect(
      isValidLiveEvent({
        type: "comment",
        threadId: "t1",
        line: 5,
        author: "reviewer",
        ts: 1000,
      })
    ).toBe(false);
  });

  it("rejects comment missing line", () => {
    expect(
      isValidLiveEvent({
        type: "comment",
        threadId: "t1",
        author: "reviewer",
        text: "Hello",
        ts: 1000,
      })
    ).toBe(false);
  });

  it("rejects event missing ts", () => {
    expect(
      isValidLiveEvent({
        type: "approve",
        author: "reviewer",
      })
    ).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidLiveEvent(null)).toBe(false);
    expect(isValidLiveEvent("string")).toBe(false);
    expect(isValidLiveEvent(42)).toBe(false);
  });
});

describe("appendEvent + readEventsFromOffset", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("appends and reads back events", () => {
    const path = join(dir, "events.jsonl");
    const event: LiveEvent = {
      type: "comment",
      threadId: "t1",
      line: 3,
      author: "reviewer",
      text: "hello",
      ts: 1000,
    };
    appendEvent(path, event);
    const { events, newOffset } = readEventsFromOffset(path, 0);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
    expect(newOffset).toBeGreaterThan(0);
  });

  it("reads only new events from offset", () => {
    const path = join(dir, "events.jsonl");
    const event1: LiveEvent = {
      type: "comment",
      threadId: "t1",
      line: 1,
      author: "reviewer",
      text: "first",
      ts: 1000,
    };
    const event2: LiveEvent = {
      type: "reply",
      threadId: "t1",
      author: "owner",
      text: "second",
      ts: 2000,
    };
    appendEvent(path, event1);
    const { newOffset: offset1 } = readEventsFromOffset(path, 0);
    appendEvent(path, event2);
    const { events, newOffset: offset2 } = readEventsFromOffset(path, offset1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event2);
    expect(offset2).toBeGreaterThan(offset1);
  });

  it("returns empty for non-existent file", () => {
    const { events, newOffset } = readEventsFromOffset(
      join(dir, "nonexistent.jsonl"),
      0
    );
    expect(events).toHaveLength(0);
    expect(newOffset).toBe(0);
  });

  it("discards malformed lines", () => {
    const path = join(dir, "events.jsonl");
    const validEvent: LiveEvent = {
      type: "approve",
      author: "reviewer",
      ts: 1000,
    };
    appendEvent(path, validEvent);
    // Manually append a malformed line
    const Bun_appendFile = require("fs").appendFileSync;
    Bun_appendFile(path, "not valid json\n");
    appendEvent(path, validEvent);

    const { events } = readEventsFromOffset(path, 0);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(validEvent);
    expect(events[1]).toEqual(validEvent);
  });

  it("handles mid-line byte offset alignment", () => {
    const path = join(dir, "events.jsonl");
    const event: LiveEvent = {
      type: "comment",
      threadId: "t1",
      line: 5,
      author: "reviewer",
      text: "test",
      ts: 1000,
    };
    appendEvent(path, event);
    // Start mid-line (offset 3 is in the middle of first line)
    const { events } = readEventsFromOffset(path, 3);
    // Should skip to next newline and not crash; may return empty or partial depending on alignment
    expect(Array.isArray(events)).toBe(true);
  });
});

describe("replayEventsToThreads", () => {
  it("creates threads from comment events", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "First comment",
        ts: 1000,
      },
      {
        type: "comment",
        threadId: "t2",
        line: 7,
        author: "reviewer",
        text: "Second comment",
        ts: 2000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(2);
    expect(threads[0].id).toBe("t1");
    expect(threads[0].line).toBe(3);
    expect(threads[0].messages[0].text).toBe("First comment");
    expect(threads[1].id).toBe("t2");
  });

  it("appends replies to threads", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Question",
        ts: 1000,
      },
      {
        type: "reply",
        threadId: "t1",
        author: "owner",
        text: "Answer",
        ts: 2000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
    expect(threads[0].messages[1].text).toBe("Answer");
  });

  it("sets status to pending after owner reply", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Question",
        ts: 1000,
      },
      {
        type: "reply",
        threadId: "t1",
        author: "owner",
        text: "Answer",
        ts: 2000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads[0].status).toBe("pending");
  });

  it("sets status to open after reviewer reply", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Question",
        ts: 1000,
      },
      {
        type: "reply",
        threadId: "t1",
        author: "owner",
        text: "Answer",
        ts: 2000,
      },
      {
        type: "reply",
        threadId: "t1",
        author: "reviewer",
        text: "Follow up",
        ts: 3000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads[0].status).toBe("open");
  });

  it("resolves thread on resolve event", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Issue",
        ts: 1000,
      },
      {
        type: "resolve",
        threadId: "t1",
        author: "reviewer",
        ts: 2000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads[0].status).toBe("resolved");
  });

  it("unresolved thread on unresolve event", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Issue",
        ts: 1000,
      },
      {
        type: "resolve",
        threadId: "t1",
        author: "reviewer",
        ts: 2000,
      },
      {
        type: "unresolve",
        threadId: "t1",
        author: "reviewer",
        ts: 3000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads[0].status).toBe("open");
  });

  it("delete removes last reviewer message", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "First",
        ts: 1000,
      },
      {
        type: "reply",
        threadId: "t1",
        author: "reviewer",
        text: "Second",
        ts: 2000,
      },
      {
        type: "delete",
        threadId: "t1",
        author: "reviewer",
        ts: 3000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].text).toBe("First");
  });

  it("excludes empty threads after all messages deleted", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "Only message",
        ts: 1000,
      },
      {
        type: "delete",
        threadId: "t1",
        author: "reviewer",
        ts: 2000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(0);
  });

  it("skips approve events (does not create threads)", () => {
    const events: LiveEvent[] = [
      {
        type: "approve",
        author: "reviewer",
        ts: 1000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(0);
  });

  it("skips round events", () => {
    const events: LiveEvent[] = [
      {
        type: "round",
        author: "owner",
        round: 2,
        ts: 1000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(0);
  });

  it("preserves timestamps on messages", () => {
    const events: LiveEvent[] = [
      {
        type: "comment",
        threadId: "t1",
        line: 3,
        author: "reviewer",
        text: "With ts",
        ts: 9999,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads[0].messages[0].ts).toBe(9999);
  });

  it("ignores replies to unknown threads", () => {
    const events: LiveEvent[] = [
      {
        type: "reply",
        threadId: "unknown-id",
        author: "owner",
        text: "Reply to nothing",
        ts: 1000,
      },
    ];
    const threads = replayEventsToThreads(events);
    expect(threads).toHaveLength(0);
  });
});

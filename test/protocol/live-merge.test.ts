import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mergeJsonlIntoReview } from "../../src/protocol/live-merge";
import { appendEvent } from "../../src/protocol/live-events";
import type { ReviewFile } from "../../src/protocol/types";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "revspec-test-"));
}

describe("mergeJsonlIntoReview", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("creates a new review from JSONL events", () => {
    const jsonlPath = join(dir, "events.jsonl");
    appendEvent(jsonlPath, {
      type: "comment",
      threadId: "t1",
      line: 3,
      author: "reviewer",
      text: "First comment",
      ts: 1000,
    });
    appendEvent(jsonlPath, {
      type: "comment",
      threadId: "t2",
      line: 7,
      author: "reviewer",
      text: "Second comment",
      ts: 2000,
    });

    const result = mergeJsonlIntoReview(jsonlPath, null, "spec.md");
    expect(result.file).toBe("spec.md");
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0].id).toBe("t1");
    expect(result.threads[1].id).toBe("t2");
  });

  it("merges with existing review threads (preserves old, adds new)", () => {
    const jsonlPath = join(dir, "events.jsonl");
    appendEvent(jsonlPath, {
      type: "comment",
      threadId: "t3",
      line: 10,
      author: "reviewer",
      text: "New from JSONL",
      ts: 1000,
    });

    const existingReview: ReviewFile = {
      file: "spec.md",
      threads: [
        {
          id: "t1",
          line: 1,
          status: "open",
          messages: [{ author: "reviewer", text: "Existing comment" }],
        },
      ],
    };

    const result = mergeJsonlIntoReview(jsonlPath, existingReview, "spec.md");
    expect(result.threads).toHaveLength(2);
    // Existing thread preserved
    expect(result.threads.find((t) => t.id === "t1")).toBeDefined();
    // New thread from JSONL added
    expect(result.threads.find((t) => t.id === "t3")).toBeDefined();
  });

  it("appends new messages to existing thread with same ID", () => {
    const jsonlPath = join(dir, "events.jsonl");
    // JSONL has comment + reply for t1
    appendEvent(jsonlPath, {
      type: "comment",
      threadId: "t1",
      line: 5,
      author: "reviewer",
      text: "Original",
      ts: 1000,
    });
    appendEvent(jsonlPath, {
      type: "reply",
      threadId: "t1",
      author: "owner",
      text: "Owner replied",
      ts: 2000,
    });

    const existingReview: ReviewFile = {
      file: "spec.md",
      threads: [
        {
          id: "t1",
          line: 5,
          status: "open",
          messages: [{ author: "reviewer", text: "Original" }],
        },
      ],
    };

    const result = mergeJsonlIntoReview(jsonlPath, existingReview, "spec.md");
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].messages).toHaveLength(2);
    expect(result.threads[0].messages[1].text).toBe("Owner replied");
    expect(result.threads[0].status).toBe("pending");
  });

  it("returns existing review unchanged if JSONL is empty", () => {
    const jsonlPath = join(dir, "events.jsonl");
    // Create empty JSONL file
    const { appendFileSync } = require("fs");
    appendFileSync(jsonlPath, "");

    const existingReview: ReviewFile = {
      file: "spec.md",
      threads: [
        {
          id: "t1",
          line: 1,
          status: "resolved",
          messages: [{ author: "reviewer", text: "Done" }],
        },
      ],
    };

    const result = mergeJsonlIntoReview(jsonlPath, existingReview, "spec.md");
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("t1");
    expect(result.threads[0].status).toBe("resolved");
  });

  it("returns a new review with empty threads if JSONL is missing and no existing review", () => {
    const jsonlPath = join(dir, "nonexistent.jsonl");
    const result = mergeJsonlIntoReview(jsonlPath, null, "spec.md");
    expect(result.file).toBe("spec.md");
    expect(result.threads).toHaveLength(0);
  });

  it("is idempotent — replaying from byte 0 each time", () => {
    const jsonlPath = join(dir, "events.jsonl");
    appendEvent(jsonlPath, {
      type: "comment",
      threadId: "t1",
      line: 3,
      author: "reviewer",
      text: "Hello",
      ts: 1000,
    });

    const result1 = mergeJsonlIntoReview(jsonlPath, null, "spec.md");
    const result2 = mergeJsonlIntoReview(jsonlPath, null, "spec.md");

    expect(result1).toEqual(result2);
    expect(result1.threads).toHaveLength(1);
  });
});

import { describe, expect, it } from "bun:test";
import { mergeDraftIntoReview } from "../../src/protocol/merge";
import type { ReviewFile, DraftFile, Thread } from "../../src/protocol/types";

const baseReview: ReviewFile = {
  file: "spec.md",
  threads: [],
};

function makeThread(id: string, messages: string[] = ["hello"]): Thread {
  return {
    id,
    line: 1,
    status: "open",
    messages: messages.map((text) => ({ author: "human", text })),
  };
}

describe("mergeDraftIntoReview", () => {
  it("adds new threads from draft to an empty review", () => {
    const draft: DraftFile = {
      threads: [makeThread("t1"), makeThread("t2")],
    };
    const result = mergeDraftIntoReview({ ...baseReview }, draft);
    expect(result.threads).toHaveLength(2);
    expect(result.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("appends only new messages to an existing thread (draft has full history)", () => {
    const existingThread: Thread = makeThread("t1", ["first message"]);
    const review: ReviewFile = { file: "spec.md", threads: [existingThread] };

    // Draft contains full history (existing + new)
    const draftThread: Thread = {
      ...existingThread,
      messages: [
        { author: "human", text: "first message" },
        { author: "ai", text: "second message" },
      ],
    };
    const draft: DraftFile = { threads: [draftThread] };

    const result = mergeDraftIntoReview(review, draft);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].messages).toHaveLength(2);
    expect(result.threads[0].messages[1].text).toBe("second message");
  });

  it("handles a mix of new and existing threads", () => {
    const existing: Thread = makeThread("t1", ["msg1"]);
    const review: ReviewFile = { file: "spec.md", threads: [existing] };

    const draftExisting: Thread = {
      ...existing,
      messages: [
        { author: "human", text: "msg1" },
        { author: "ai", text: "reply" },
      ],
    };
    const draftNew: Thread = makeThread("t2", ["new thread"]);
    const draft: DraftFile = { threads: [draftExisting, draftNew] };

    const result = mergeDraftIntoReview(review, draft);
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0].messages).toHaveLength(2);
    expect(result.threads[1].id).toBe("t2");
  });

  it("updates thread status from draft", () => {
    const existing: Thread = { ...makeThread("t1"), status: "open" };
    const review: ReviewFile = { file: "spec.md", threads: [existing] };

    const draftThread: Thread = {
      ...existing,
      status: "resolved",
      messages: existing.messages,
    };
    const draft: DraftFile = { threads: [draftThread] };

    const result = mergeDraftIntoReview(review, draft);
    expect(result.threads[0].status).toBe("resolved");
  });

  it("returns review unchanged when draft has no threads", () => {
    const thread: Thread = makeThread("t1");
    const review: ReviewFile = { file: "spec.md", threads: [thread] };
    const draft: DraftFile = { approved: true };

    const result = mergeDraftIntoReview(review, draft);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("t1");
  });

  it("creates a new ReviewFile with specFile when review is null", () => {
    const draft: DraftFile = { threads: [makeThread("t1")] };
    const result = mergeDraftIntoReview(null, draft, "new-spec.md");
    expect(result.file).toBe("new-spec.md");
    expect(result.threads).toHaveLength(1);
  });
});

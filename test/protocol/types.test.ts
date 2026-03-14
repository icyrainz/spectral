import { describe, expect, it } from "bun:test";
import {
  isValidStatus,
  isValidThread,
  isValidReviewFile,
} from "../../src/protocol/types";

describe("isValidStatus", () => {
  it("accepts open", () => expect(isValidStatus("open")).toBe(true));
  it("accepts pending", () => expect(isValidStatus("pending")).toBe(true));
  it("accepts resolved", () => expect(isValidStatus("resolved")).toBe(true));
  it("accepts outdated", () => expect(isValidStatus("outdated")).toBe(true));
  it("rejects addressed", () => expect(isValidStatus("addressed")).toBe(false));
  it("rejects empty string", () => expect(isValidStatus("")).toBe(false));
  it("rejects OPEN (uppercase)", () => expect(isValidStatus("OPEN")).toBe(false));
});

describe("isValidThread", () => {
  it("accepts a minimal valid thread", () => {
    expect(
      isValidThread({
        id: "t1",
        line: 5,
        status: "open",
        messages: [{ author: "human", text: "hello" }],
      })
    ).toBe(true);
  });

  it("rejects thread missing line", () => {
    expect(
      isValidThread({
        id: "t1",
        status: "open",
        messages: [],
      })
    ).toBe(false);
  });

  it("rejects thread missing messages", () => {
    expect(
      isValidThread({
        id: "t1",
        line: 3,
        status: "open",
      })
    ).toBe(false);
  });

  it("rejects thread with invalid status", () => {
    expect(
      isValidThread({
        id: "t1",
        line: 3,
        status: "addressed",
        messages: [],
      })
    ).toBe(false);
  });
});

describe("isValidReviewFile", () => {
  it("accepts a valid review file", () => {
    expect(
      isValidReviewFile({
        file: "spec.md",
        threads: [
          {
            id: "t1",
            line: 1,
            status: "open",
            messages: [{ author: "human", text: "comment" }],
          },
        ],
      })
    ).toBe(true);
  });

  it("accepts a review file with empty threads array", () => {
    expect(
      isValidReviewFile({
        file: "spec.md",
        threads: [],
      })
    ).toBe(true);
  });

  it("rejects a review file missing the file field", () => {
    expect(
      isValidReviewFile({
        threads: [],
      })
    ).toBe(false);
  });
});

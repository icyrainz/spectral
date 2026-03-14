import { describe, expect, it } from "bun:test";
import { buildPagerContent } from "../../src/tui/pager";
import { ReviewState } from "../../src/state/review-state";
import type { Thread } from "../../src/protocol/types";

const SPEC = ["# Title", "Some text", "More text", "Final line"];

function makeThread(
  id: string,
  line: number,
  status: Thread["status"],
  messages: Thread["messages"] = [{ author: "human", text: "comment" }]
): Thread {
  return { id, line, status, messages };
}

describe("buildPagerContent", () => {
  it("renders lines with line numbers", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines).toHaveLength(4);
    // Line 1 is the cursor line, gets ">" prefix
    expect(lines[0]).toContain("   1");
    expect(lines[0]).toContain("# Title");
    // Other lines get " " prefix
    expect(lines[1]).toContain("   2");
    expect(lines[1]).toContain("Some text");
    expect(lines[2]).toContain("   3");
    expect(lines[3]).toContain("   4");
  });

  it("marks cursor line with > prefix", () => {
    const state = new ReviewState(SPEC, []);
    state.cursorLine = 3;
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Line 3 (index 2) should have ">" prefix (possibly preceded by ANSI cursor bg)
    expect(lines[2]).toMatch(/^(\x1b\[48;2;49;50;68m)?>/);
    // Other lines should have " " prefix
    expect(lines[0]).toMatch(/^ /);
    expect(lines[1]).toMatch(/^ /);
    expect(lines[3]).toMatch(/^ /);
  });

  it("shows status indicator for open threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "open")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Line 2 should contain the open icon (speech balloon)
    expect(lines[1]).toContain("\u{1F4AC}");
  });

  it("shows status indicator for pending threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "pending")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u{1F535}");
  });

  it("shows status indicator for resolved threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "resolved")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u2714");
  });

  it("shows status indicator for outdated threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "outdated")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u26A0");
  });

  it("shows different icons for different statuses", () => {
    const state = new ReviewState(SPEC, [
      makeThread("t1", 1, "open"),
      makeThread("t2", 2, "pending"),
      makeThread("t3", 3, "resolved"),
      makeThread("t4", 4, "outdated"),
    ]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[0]).toContain("\u{1F4AC}");
    expect(lines[1]).toContain("\u{1F535}");
    expect(lines[2]).toContain("\u2714");
    expect(lines[3]).toContain("\u26A0");
  });

  it("shows thread hint with latest message text", () => {
    const state = new ReviewState(SPEC, [
      makeThread("t1", 2, "open", [
        { author: "ai", text: "AI said something" },
        { author: "human", text: "My response" },
      ]),
    ]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("My response");
  });

  it("truncates long comment text to 40 chars", () => {
    const longText =
      "This is a very long comment that should be truncated because it exceeds the maximum hint length";
    const state = new ReviewState(SPEC, [
      makeThread("t1", 2, "open", [{ author: "human", text: longText }]),
    ]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Should be truncated to 39 chars + ellipsis
    expect(lines[1]).toContain("\u2026");
    // The full text should NOT appear
    expect(lines[1]).not.toContain(longText);
  });

  it("does not show status indicator for lines without threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "open")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Line 1 (no thread) should not contain any status icons
    expect(lines[0]).not.toContain("\u{1F4AC}");
    expect(lines[0]).not.toContain("\u{1F535}");
    expect(lines[0]).not.toContain("\u2714");
    expect(lines[0]).not.toContain("\u26A0");
  });

  it("pads line numbers to 4 characters", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Line numbers are wrapped in ANSI gray codes, so check the raw number is present
    expect(lines[0]).toContain("   1");
    expect(lines[0]).toContain("# Title");
  });

  it("handles empty spec", () => {
    const state = new ReviewState([], []);
    const content = buildPagerContent(state);
    expect(content).toBe("");
  });
});

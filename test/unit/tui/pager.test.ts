import { describe, expect, it } from "bun:test";
import { buildPagerContent, countExtraVisualLines } from "../../../src/tui/pager";
import { ReviewState } from "../../../src/state/review-state";
import type { Thread } from "../../../src/protocol/types";

const SPEC = ["# Title", "Some text", "More text", "Final line"];

function makeThread(
  id: string,
  line: number,
  status: Thread["status"],
  messages: Thread["messages"] = [{ author: "reviewer", text: "comment" }]
): Thread {
  return { id, line, status, messages };
}

describe("buildPagerContent", () => {
  it("renders lines with line numbers", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("   1");
    expect(lines[0]).toContain("# Title");
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

    expect(lines[2]).toMatch(/^>/);
    expect(lines[0]).toMatch(/^ /);
    expect(lines[1]).toMatch(/^ /);
    expect(lines[3]).toMatch(/^ /);
  });

  it("shows gutter indicator for open threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "open")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u258c");
  });

  it("shows gutter indicator for pending threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "pending")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u258c");
  });

  it("shows checkmark for resolved threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "resolved")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("=");
  });

  it("shows gutter indicator for outdated threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "outdated")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[1]).toContain("\u258c");
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

    expect(lines[0]).toContain("\u258c");
    expect(lines[1]).toContain("\u258c");
    expect(lines[2]).toContain("=");
    expect(lines[3]).toContain("\u258c");
  });

  it("does not show inline comment preview (removed)", () => {
    const state = new ReviewState(SPEC, [
      makeThread("t1", 2, "open", [
        { author: "reviewer", text: "My response" },
      ]),
    ]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    // Only gutter indicator, no inline text preview
    expect(lines[1]).toContain("\u258c");
    expect(lines[1]).not.toContain("My response");
  });

  it("does not show status indicator for lines without threads", () => {
    const state = new ReviewState(SPEC, [makeThread("t1", 2, "open")]);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[0]).not.toContain("\u258c");
    expect(lines[0]).not.toContain("\u2713");
  });

  it("pads line numbers to 4 characters", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state);
    const lines = content.split("\n");

    expect(lines[0]).toContain("   1");
    expect(lines[0]).toContain("# Title");
  });

  it("handles empty spec", () => {
    const state = new ReviewState([], []);
    const content = buildPagerContent(state);
    expect(content).toBe("");
  });

  it("highlights search matches with >> << markers", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state, "text");
    const lines = content.split("\n");

    expect(lines[1]).toContain("Some >>text<<");
    expect(lines[2]).toContain("More >>text<<");
    expect(lines[0]).not.toContain(">>");
    expect(lines[3]).not.toContain(">>");
  });

  it("highlights search matches case-insensitively", () => {
    const state = new ReviewState(["Hello World", "hello again"], []);
    const content = buildPagerContent(state, "hello");
    const lines = content.split("\n");

    expect(lines[0]).toContain(">>Hello<<");
    expect(lines[1]).toContain(">>hello<<");
  });

  it("does not highlight when searchQuery is null", () => {
    const state = new ReviewState(SPEC, []);
    const content = buildPagerContent(state, null);
    const lines = content.split("\n");

    expect(lines[1]).toContain("Some text");
    expect(lines[1]).not.toContain(">>");
  });

});

describe("countExtraVisualLines — table borders", () => {
  it("counts top and bottom borders for a table outside code blocks", () => {
    const specLines = [
      "Some text",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "End text",
    ];
    // Cursor past the table — should count both top and bottom borders
    const extra = countExtraVisualLines(specLines, 4);
    expect(extra).toBe(2);
  });

  it("does not count borders for pipe lines inside a fenced code block", () => {
    const specLines = [
      "Some text",
      "```",
      "| not | a table |",
      "| just | code |",
      "```",
      "End text",
    ];
    // Cursor past everything — code block pipes should not produce table borders
    const extra = countExtraVisualLines(specLines, 5);
    expect(extra).toBe(0);
  });

  it("counts borders for table after a code block closes", () => {
    const specLines = [
      "```",
      "| code | line |",
      "```",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "End",
    ];
    // Cursor past everything — only the real table (lines 3-5) gets borders
    const extra = countExtraVisualLines(specLines, 6);
    expect(extra).toBe(2);
  });

  it("handles mixed code blocks and tables", () => {
    const specLines = [
      "# Header",
      "```",
      "x | y | z",
      "```",
      "| Col1 | Col2 |",
      "| --- | --- |",
      "| val1 | val2 |",
      "```",
      "a | b | c",
      "```",
      "Done",
    ];
    // Cursor at end — only lines 4-6 form a real table
    const extra = countExtraVisualLines(specLines, 10);
    expect(extra).toBe(2);
  });
});

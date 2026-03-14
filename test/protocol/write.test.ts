import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { writeReviewFile, writeDraftFile } from "../../src/protocol/write";
import type { ReviewFile, DraftFile } from "../../src/protocol/types";

function tmpDir() {
  return mkdtempSync("/tmp/spectral-test-");
}

describe("writeReviewFile", () => {
  it("writes valid JSON that can be parsed back to ReviewFile", () => {
    const dir = tmpDir();
    const filePath = join(dir, "review.json");
    const data: ReviewFile = {
      file: "spec.md",
      threads: [
        {
          id: "t1",
          line: 3,
          status: "open",
          messages: [{ author: "human", text: "Is this right?" }],
        },
      ],
    };
    writeReviewFile(filePath, data);
    const raw = readFileSync(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual(data);
    rmSync(dir, { recursive: true });
  });

  it("writes pretty-printed JSON (contains newlines)", () => {
    const dir = tmpDir();
    const filePath = join(dir, "review.json");
    const data: ReviewFile = { file: "spec.md", threads: [] };
    writeReviewFile(filePath, data);
    const raw = readFileSync(filePath, "utf8");
    expect(raw).toContain("\n");
    rmSync(dir, { recursive: true });
  });
});

describe("writeDraftFile", () => {
  it("writes an approval draft", () => {
    const dir = tmpDir();
    const filePath = join(dir, "draft.json");
    const data: DraftFile = { approved: true };
    writeDraftFile(filePath, data);
    const raw = readFileSync(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual(data);
    rmSync(dir, { recursive: true });
  });

  it("writes a threads draft", () => {
    const dir = tmpDir();
    const filePath = join(dir, "draft.json");
    const data: DraftFile = {
      threads: [
        {
          id: "t2",
          line: 7,
          status: "resolved",
          messages: [{ author: "ai", text: "Fixed." }],
        },
      ],
    };
    writeDraftFile(filePath, data);
    const raw = readFileSync(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual(data);
    rmSync(dir, { recursive: true });
  });
});

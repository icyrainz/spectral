import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { readReviewFile, readDraftFile } from "../../src/protocol/read";
import type { ReviewFile, DraftFile } from "../../src/protocol/types";

function tmpDir() {
  return mkdtempSync("/tmp/revspec-test-");
}

describe("readReviewFile", () => {
  it("returns null for a missing file", () => {
    expect(readReviewFile("/nonexistent/path/review.json")).toBeNull();
  });

  it("returns parsed ReviewFile for a valid file", () => {
    const dir = tmpDir();
    const filePath = join(dir, "review.json");
    const data: ReviewFile = {
      file: "spec.md",
      threads: [
        {
          id: "t1",
          line: 10,
          status: "open",
          messages: [{ author: "reviewer", text: "Looks good?" }],
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(data));
    const result = readReviewFile(filePath);
    expect(result).toEqual(data);
    rmSync(dir, { recursive: true });
  });

  it("returns null for invalid JSON", () => {
    const dir = tmpDir();
    const filePath = join(dir, "review.json");
    writeFileSync(filePath, "not valid json {{");
    expect(readReviewFile(filePath)).toBeNull();
    rmSync(dir, { recursive: true });
  });

  it("returns null when JSON doesn't match ReviewFile schema", () => {
    const dir = tmpDir();
    const filePath = join(dir, "review.json");
    writeFileSync(filePath, JSON.stringify({ threads: [] })); // missing 'file'
    expect(readReviewFile(filePath)).toBeNull();
    rmSync(dir, { recursive: true });
  });
});

describe("readDraftFile", () => {
  it("returns null for a missing file", () => {
    expect(readDraftFile("/nonexistent/path/draft.json")).toBeNull();
  });

  it("returns parsed DraftFile for an approval draft", () => {
    const dir = tmpDir();
    const filePath = join(dir, "draft.json");
    const data: DraftFile = { approved: true };
    writeFileSync(filePath, JSON.stringify(data));
    expect(readDraftFile(filePath)).toEqual(data);
    rmSync(dir, { recursive: true });
  });

  it("returns parsed DraftFile for a threads draft", () => {
    const dir = tmpDir();
    const filePath = join(dir, "draft.json");
    const data: DraftFile = {
      threads: [
        {
          id: "t2",
          line: 5,
          status: "pending",
          messages: [{ author: "owner", text: "Response here" }],
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(data));
    expect(readDraftFile(filePath)).toEqual(data);
    rmSync(dir, { recursive: true });
  });

  it("returns null for corrupted JSON", () => {
    const dir = tmpDir();
    const filePath = join(dir, "draft.json");
    writeFileSync(filePath, "{bad json");
    expect(readDraftFile(filePath)).toBeNull();
    rmSync(dir, { recursive: true });
  });
});

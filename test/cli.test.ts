import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { appendEvent } from "../src/protocol/live-events";
import { writeReviewFile } from "../src/protocol/write";

const CLI = resolve(import.meta.dir, "../bin/revspec.ts");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { ...process.env, REVSPEC_SKIP_TUI: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("CLI entry point", () => {
  let tmpDir: string;

  // Create a fresh temp dir before each test
  function setup(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "revspec-test-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exits 1 for missing spec file", async () => {
    setup();
    const result = await runCli([join(tmpDir, "nonexistent.md")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("exits 0 with no output when no review file exists", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  it("outputs APPROVED when JSONL has approve event and review file exists", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    // Write a review file (TUI writes this on approve)
    const reviewPath = join(dir, "spec.review.json");
    writeReviewFile(reviewPath, { file: specFile, threads: [] });

    // Simulate TUI writing an approve event to JSONL
    const jsonlPath = join(dir, "spec.review.live.jsonl");
    appendEvent(jsonlPath, { type: "approve", author: "reviewer", ts: Date.now() });

    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("APPROVED:");
    expect(result.stdout).toContain("spec.review.json");
  });

  it("outputs review path when review file has open threads", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    const reviewPath = join(dir, "spec.review.json");
    writeReviewFile(reviewPath, {
      file: specFile,
      threads: [
        {
          id: "t1",
          line: 5,
          status: "open",
          messages: [{ author: "reviewer", text: "This needs clarification" }],
        },
      ],
    });

    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("spec.review.json");
  });

  it("prints nothing when human adds no comments (no prior review)", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    // No JSONL, no review file — TUI is skipped, nothing happened
    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("prints nothing when review exists but all threads resolved", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    const reviewPath = join(dir, "spec.review.json");
    writeReviewFile(reviewPath, {
      file: specFile,
      threads: [
        {
          id: "t1",
          line: 5,
          status: "resolved",
          messages: [
            { author: "reviewer", text: "Was unclear" },
            { author: "owner", text: "Fixed" },
          ],
        },
      ],
    });

    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("does not output APPROVED if JSONL has approve but no review file", async () => {
    const dir = setup();
    const specFile = join(dir, "spec.md");
    writeFileSync(specFile, "# My Spec\n");

    // JSONL has approve but no review file written
    const jsonlPath = join(dir, "spec.review.live.jsonl");
    appendEvent(jsonlPath, { type: "approve", author: "reviewer", ts: Date.now() });

    const result = await runCli([specFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("APPROVED:");
  });
});

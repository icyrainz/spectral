import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { appendEvent, readEventsFromOffset } from "../src/protocol/live-events";

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
    env: { ...process.env, ...env },
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

function setupTempDir(): string {
  return mkdtempSync(join(tmpdir(), "revspec-test-"));
}

function createTestFixtures(dir: string): {
  specPath: string;
  jsonlPath: string;
  threadId: string;
} {
  const specPath = join(dir, "spec.md");
  writeFileSync(specPath, "# My Spec\n\nSome content here.\n");

  const jsonlPath = join(dir, "spec.review.live.jsonl");
  const threadId = "thread-001";

  // Write a comment event so the thread exists
  appendEvent(jsonlPath, {
    type: "comment",
    threadId,
    line: 3,
    author: "reviewer",
    text: "This needs clarification",
    ts: Date.now(),
  });

  return { specPath, jsonlPath, threadId };
}

describe("revspec reply", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("appends owner reply event to JSONL", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath, threadId } = createTestFixtures(tmpDir);

    const result = await runCli([
      "reply",
      specPath,
      threadId,
      "Thanks for the feedback!",
    ]);

    expect(result.exitCode).toBe(0);

    // Read events back and verify reply was appended
    const { events } = readEventsFromOffset(jsonlPath, 0);
    const replyEvents = events.filter(
      (e) => e.type === "reply" && e.threadId === threadId
    );
    expect(replyEvents).toHaveLength(1);
    expect(replyEvents[0].author).toBe("owner");
    expect(replyEvents[0].text).toBe("Thanks for the feedback!");
  });

  it("exits 1 for unknown thread ID", async () => {
    tmpDir = setupTempDir();
    const { specPath } = createTestFixtures(tmpDir);

    const result = await runCli([
      "reply",
      specPath,
      "unknown-thread-id",
      "Some text",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Thread ID not found");
  });

  it("exits 1 for empty text", async () => {
    tmpDir = setupTempDir();
    const { specPath, threadId } = createTestFixtures(tmpDir);

    const result = await runCli(["reply", specPath, threadId, "   "]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("empty");
  });

  it("preserves newlines in reply text", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath, threadId } = createTestFixtures(tmpDir);

    const textWithNewlines = "Line one\nLine two\nLine three";
    const result = await runCli([
      "reply",
      specPath,
      threadId,
      textWithNewlines,
    ]);

    expect(result.exitCode).toBe(0);

    const { events } = readEventsFromOffset(jsonlPath, 0);
    const replyEvents = events.filter(
      (e) => e.type === "reply" && e.threadId === threadId
    );
    expect(replyEvents).toHaveLength(1);
    expect(replyEvents[0].text).toBe(textWithNewlines);
  });
});

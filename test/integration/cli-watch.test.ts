import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { appendEvent, readEventsFromOffset } from "../../src/protocol/live-events";

const CLI = resolve(import.meta.dir, "../../bin/revspec.ts");

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
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1", ...env },
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
  return mkdtempSync(join(tmpdir(), "revspec-watch-test-"));
}

function createSpecWithJsonl(
  dir: string,
  specContent: string = "# My Spec\n\nLine two\n\nLine four\n"
): { specPath: string; jsonlPath: string } {
  const specPath = join(dir, "spec.md");
  writeFileSync(specPath, specContent);

  const jsonlPath = join(dir, "spec.review.live.jsonl");

  return { specPath, jsonlPath };
}

describe("revspec watch", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns new comments with context", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    const threadId = "thread-001";
    appendEvent(jsonlPath, {
      type: "comment",
      threadId,
      line: 3,
      author: "reviewer",
      text: "This needs clarification",
      ts: Date.now(),
    });

    const result = await runCli(["watch", specPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(threadId);
    expect(result.stdout).toContain("line 3");
    expect(result.stdout).toContain("This needs clarification");
    expect(result.stdout).toContain("revspec reply");
  });

  it("returns approval message when approve event present", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    appendEvent(jsonlPath, {
      type: "approve",
      author: "reviewer",
      ts: Date.now(),
    });

    const result = await runCli(["watch", specPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Review approved");
  });

  it("includes thread history for replies", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    const threadId = "thread-002";
    const ts = Date.now();

    appendEvent(jsonlPath, {
      type: "comment",
      threadId,
      line: 1,
      author: "reviewer",
      text: "Initial comment",
      ts,
    });

    appendEvent(jsonlPath, {
      type: "reply",
      threadId,
      author: "owner",
      text: "Thanks, addressing it",
      ts: ts + 1000,
    });

    appendEvent(jsonlPath, {
      type: "reply",
      threadId,
      author: "reviewer",
      text: "Great, looks good now",
      ts: ts + 2000,
    });

    // Watch starting at offset 0 should see new comment + replies
    const result = await runCli(["watch", specPath]);

    expect(result.exitCode).toBe(0);
    // Should show full thread history in replies section
    expect(result.stdout).toContain(threadId);
    expect(result.stdout).toContain("Initial comment");
    expect(result.stdout).toContain("Thanks, addressing it");
    expect(result.stdout).toContain("Great, looks good now");
  });

  it("does not break watch loop for resolve-only events", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    const threadId = "thread-003";
    const ts = Date.now();

    // Write comment then resolve
    appendEvent(jsonlPath, {
      type: "comment",
      threadId,
      line: 2,
      author: "reviewer",
      text: "Fix this please",
      ts,
    });

    // First watch picks up the comment
    const result1 = await runCli(["watch", specPath]);
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout).toContain("Fix this please");

    // Append resolve — watch should return empty (no actionable events)
    appendEvent(jsonlPath, {
      type: "resolve",
      threadId,
      author: "reviewer",
      ts: ts + 1000,
    });

    const result2 = await runCli(["watch", specPath]);
    // No output — resolve is not actionable
    expect(result2.stdout.trim()).toBe("");
  });

  it("exits 1 for missing spec file", async () => {
    tmpDir = setupTempDir();
    const missingPath = join(tmpDir, "nonexistent.md");

    const result = await runCli(["watch", missingPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("exits 3 when another watch is running (lock file with live PID)", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);
    const lockPath = join(tmpDir, "spec.review.live.lock");
    writeFileSync(lockPath, String(process.pid)); // current process is alive
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 1, author: "reviewer", text: "x", ts: 1 });

    const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    });
    await proc.exited;
    expect(proc.exitCode).toBe(3);
  });

  it("proceeds when lock file has dead PID", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);
    const lockPath = join(tmpDir, "spec.review.live.lock");
    writeFileSync(lockPath, "999999"); // almost certainly dead
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 1, author: "reviewer", text: "x", ts: 1 });

    const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
  });

  it("outputs submit message with resolved threads", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 5, author: "reviewer", text: "unclear", ts: 1 });
    appendEvent(jsonlPath, { type: "reply", threadId: "x1", author: "owner", text: "will clarify", ts: 2 });
    appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 3 });
    appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 4 });

    const result = await runCli(["watch", specPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Submit: Rewrite Requested");
    expect(result.stdout).toContain("x1 (line 5)");
    expect(result.stdout).toContain("unclear");
    expect(result.stdout).toContain("will clarify");
  });

  it("recovers pending submit on restart", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 3, author: "reviewer", text: "fix this", ts: 1 });
    appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 2 });
    appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 3 });

    // First watch — consumes the submit
    await runCli(["watch", specPath]);

    // Second watch — should re-output the pending submit
    const result = await runCli(["watch", specPath]);

    expect(result.stdout).toContain("Submit: Rewrite Requested");
    expect(result.stdout).toContain("fix this");
  });

  it("submit takes priority over session-end in same batch", async () => {
    tmpDir = setupTempDir();
    const { specPath, jsonlPath } = createSpecWithJsonl(tmpDir);

    appendEvent(jsonlPath, { type: "comment", threadId: "x1", line: 1, author: "reviewer", text: "change this", ts: 1 });
    appendEvent(jsonlPath, { type: "resolve", threadId: "x1", author: "reviewer", ts: 2 });
    appendEvent(jsonlPath, { type: "submit", author: "reviewer", ts: 3 });
    appendEvent(jsonlPath, { type: "session-end", author: "reviewer", ts: 4 });

    const result = await runCli(["watch", specPath]);

    expect(result.stdout).toContain("Submit: Rewrite Requested");
    expect(result.stdout).not.toContain("Session ended");
  });
});

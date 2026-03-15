import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { appendEvent, readEventsFromOffset } from "../src/protocol/live-events"
import { mergeJsonlIntoReview } from "../src/protocol/live-merge"
import { writeReviewFile } from "../src/protocol/write"

const CLI = join(import.meta.dir, "..", "bin", "revspec.ts")

describe("E2E: live review loop", () => {
  let dir: string
  let specPath: string
  let jsonlPath: string
  let reviewPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "revspec-e2e-"))
    specPath = join(dir, "spec.md")
    jsonlPath = join(dir, "spec.review.live.jsonl")
    reviewPath = join(dir, "spec.review.json")
    writeFileSync(specPath, "# My Spec\n\nLine 3 is important.\n\nLine 5 also matters.\n")
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it("simulates full loop: comment → watch → reply → watch → resolve → approve", async () => {
    // Step 1: Reviewer adds comments (simulating TUI)
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 3, author: "reviewer", text: "this is unclear", ts: 1000 })
    appendEvent(jsonlPath, { type: "comment", threadId: "t2", line: 5, author: "reviewer", text: "needs more detail", ts: 1001 })

    // Step 2: AI runs watch, gets comments
    const watch1 = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    })
    const output1 = await new Response(watch1.stdout).text()
    await watch1.exited
    expect(watch1.exitCode).toBe(0)
    expect(output1).toContain("t1")
    expect(output1).toContain("t2")
    expect(output1).toContain("this is unclear")
    expect(output1).toContain("needs more detail")

    // Step 3: AI replies
    const reply1 = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "I'll restructure this section"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply1.exited
    expect(reply1.exitCode).toBe(0)

    const reply2 = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t2", "Adding more context now"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply2.exited
    expect(reply2.exitCode).toBe(0)

    // Verify AI replies are in JSONL
    const { events } = readEventsFromOffset(jsonlPath, 0)
    expect(events).toHaveLength(4) // 2 comments + 2 replies
    expect(events[2].author).toBe("owner")
    expect(events[3].author).toBe("owner")

    // Step 4: Reviewer resolves and approves (simulating TUI)
    appendEvent(jsonlPath, { type: "resolve", threadId: "t1", author: "reviewer", ts: 2000 })
    appendEvent(jsonlPath, { type: "resolve", threadId: "t2", author: "reviewer", ts: 2001 })
    appendEvent(jsonlPath, { type: "approve", author: "reviewer", ts: 2002 })

    // Step 5: AI runs watch, gets approval
    const watch2 = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    })
    const output2 = await new Response(watch2.stdout).text()
    await watch2.exited
    expect(watch2.exitCode).toBe(0)
    expect(output2).toContain("Review approved")

    // Step 6: Merge JSONL → JSON (simulating TUI exit)
    const review = mergeJsonlIntoReview(jsonlPath, null, specPath)
    writeReviewFile(reviewPath, review)
    expect(review.threads).toHaveLength(2)
    expect(review.threads[0].status).toBe("resolved")
    expect(review.threads[1].status).toBe("resolved")
    expect(review.threads[0].messages).toHaveLength(2)
    expect(review.threads[1].messages).toHaveLength(2)
    expect(review.threads[0].messages[0].ts).toBe(1000) // timestamps preserved
  })

  it("handles delete event in the loop", async () => {
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 3, author: "reviewer", text: "wrong comment", ts: 1000 })
    appendEvent(jsonlPath, { type: "delete", threadId: "t1", author: "reviewer", ts: 1001 })

    const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited

    // Watch should show the events
    expect(proc.exitCode).toBe(0)

    // Merge should exclude empty thread
    const review = mergeJsonlIntoReview(jsonlPath, null, specPath)
    expect(review.threads).toHaveLength(0)
  })

  it("merges with existing review from prior round", async () => {
    // Prior round left a resolved thread
    const priorReview = {
      file: specPath,
      threads: [{
        id: "t1", line: 3, status: "resolved" as const,
        messages: [
          { author: "reviewer" as const, text: "old comment" },
          { author: "owner" as const, text: "fixed" },
        ]
      }],
    }
    writeReviewFile(reviewPath, priorReview)

    // New round
    appendEvent(jsonlPath, { type: "round", author: "reviewer", round: 2, ts: 3000 })
    appendEvent(jsonlPath, { type: "comment", threadId: "t2", line: 5, author: "reviewer", text: "new issue", ts: 3001 })

    const review = mergeJsonlIntoReview(jsonlPath, priorReview, specPath)
    expect(review.threads).toHaveLength(2)
    expect(review.threads[0].id).toBe("t1")
    expect(review.threads[1].id).toBe("t2")
  })

  it("watch output includes spec context lines", async () => {
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 3, author: "reviewer", text: "unclear", ts: 1000 })

    const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited

    // Should include context lines around line 3
    expect(output).toContain("Line 3 is important")
    expect(output).toContain(">")  // cursor marker on the anchored line
  })

  it("reply then watch shows thread history", async () => {
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 3, author: "reviewer", text: "unclear", ts: 1000 })

    // AI replies
    const reply = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "I'll clarify"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply.exited

    // Reviewer replies back
    appendEvent(jsonlPath, { type: "reply", threadId: "t1", author: "reviewer", text: "not quite", ts: 2000 })

    const proc = Bun.spawn(["bun", "run", CLI, "watch", specPath], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1" },
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited

    expect(output).toContain("Replies")
    expect(output).toContain("unclear")
    expect(output).toContain("not quite")
  })
})

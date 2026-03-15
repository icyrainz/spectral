import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs"
import { join, resolve } from "path"
import { tmpdir } from "os"
import { appendEvent, readEventsFromOffset, replayEventsToThreads } from "../src/protocol/live-events"
import { mergeJsonlIntoReview } from "../src/protocol/live-merge"
import { ReviewState } from "../src/state/review-state"

const CLI = resolve(import.meta.dir, "../bin/revspec.ts")

interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { ...process.env, REVSPEC_WATCH_NO_BLOCK: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe("live interaction: multi-turn conversation", () => {
  let dir: string
  let specPath: string
  let jsonlPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "revspec-interaction-"))
    specPath = join(dir, "spec.md")
    jsonlPath = join(dir, "spec.review.live.jsonl")
    writeFileSync(specPath, "# Spec\n\nLine 3.\n\nLine 5.\n")
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it("multiple replies in sequence: all messages in JSONL in correct order with correct authors", async () => {
    // Reviewer comments
    appendEvent(jsonlPath, {
      type: "comment", threadId: "t1", line: 3,
      author: "reviewer", text: "first comment", ts: 1000,
    })

    // AI replies
    const reply1 = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "first AI reply"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply1.exited
    expect(reply1.exitCode).toBe(0)

    // Reviewer replies back
    appendEvent(jsonlPath, {
      type: "reply", threadId: "t1",
      author: "reviewer", text: "second comment", ts: 3000,
    })

    // AI replies again
    const reply2 = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "second AI reply"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply2.exited
    expect(reply2.exitCode).toBe(0)

    // Verify all four messages are in JSONL in correct order
    const { events } = readEventsFromOffset(jsonlPath, 0)
    expect(events).toHaveLength(4)

    expect(events[0].type).toBe("comment")
    expect(events[0].author).toBe("reviewer")
    expect(events[0].text).toBe("first comment")

    expect(events[1].type).toBe("reply")
    expect(events[1].author).toBe("owner")
    expect(events[1].text).toBe("first AI reply")

    expect(events[2].type).toBe("reply")
    expect(events[2].author).toBe("reviewer")
    expect(events[2].text).toBe("second comment")

    expect(events[3].type).toBe("reply")
    expect(events[3].author).toBe("owner")
    expect(events[3].text).toBe("second AI reply")

    // Verify replayed thread has all 4 messages
    const threads = replayEventsToThreads(events)
    expect(threads).toHaveLength(1)
    expect(threads[0].messages).toHaveLength(4)
    expect(threads[0].messages[0].author).toBe("reviewer")
    expect(threads[0].messages[1].author).toBe("owner")
    expect(threads[0].messages[2].author).toBe("reviewer")
    expect(threads[0].messages[3].author).toBe("owner")
  })

  it("reply after resolve: merged status reflects AI reply (pending, not resolved)", async () => {
    // Reviewer comments
    appendEvent(jsonlPath, {
      type: "comment", threadId: "t1", line: 3,
      author: "reviewer", text: "something", ts: 1000,
    })

    // Reviewer resolves
    appendEvent(jsonlPath, {
      type: "resolve", threadId: "t1",
      author: "reviewer", ts: 2000,
    })

    // AI replies after resolve (race condition)
    const reply = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "AI reply after resolve"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply.exited
    expect(reply.exitCode).toBe(0)

    // Merge JSONL: last event is AI reply so status should be pending
    const merged = mergeJsonlIntoReview(jsonlPath, null, specPath)
    expect(merged.threads).toHaveLength(1)
    expect(merged.threads[0].status).toBe("pending")
    expect(merged.threads[0].messages).toHaveLength(2)
    expect(merged.threads[0].messages[1].author).toBe("owner")
    expect(merged.threads[0].messages[1].text).toBe("AI reply after resolve")
  })

  it("watch filters out owner events: AI own reply not shown back to AI", async () => {
    // Reviewer comments
    appendEvent(jsonlPath, {
      type: "comment", threadId: "t1", line: 3,
      author: "reviewer", text: "initial comment", ts: 1000,
    })

    // Run watch once — consumes the comment, advances offset
    const watch1 = await runCli(["watch", specPath])
    expect(watch1.exitCode).toBe(0)
    expect(watch1.stdout).toContain("initial comment")

    // AI replies
    const reply = Bun.spawn(["bun", "run", CLI, "reply", specPath, "t1", "AI reply text"], {
      stdout: "pipe", stderr: "pipe",
    })
    await reply.exited
    expect(reply.exitCode).toBe(0)

    // Run watch again — offset now points past the comment but at the AI reply
    // The AI reply is an "owner" event, so watch should filter it out and produce no output
    const watch2 = await runCli(["watch", specPath])
    expect(watch2.exitCode).toBe(0)
    expect(watch2.stdout).not.toContain("AI reply text")
    expect(watch2.stdout.trim()).toBe("")
  })

  it("watch only returns actionable events (comments and replies), ignores resolves and deletes", async () => {
    // Set up: write comment and advance offset past it
    appendEvent(jsonlPath, {
      type: "comment", threadId: "t1", line: 3,
      author: "reviewer", text: "initial comment", ts: 1000,
    })
    await runCli(["watch", specPath])

    // Append mixed batch: resolve + delete (non-actionable) + new comment + reply (actionable)
    appendEvent(jsonlPath, {
      type: "resolve", threadId: "t1",
      author: "reviewer", ts: 2000,
    })
    appendEvent(jsonlPath, {
      type: "delete", threadId: "t1",
      author: "reviewer", ts: 2001,
    })
    appendEvent(jsonlPath, {
      type: "comment", threadId: "t3", line: 3,
      author: "reviewer", text: "fresh comment", ts: 2002,
    })
    appendEvent(jsonlPath, {
      type: "reply", threadId: "t1",
      author: "reviewer", text: "actually not resolved", ts: 2003,
    })

    const result = await runCli(["watch", specPath])
    expect(result.exitCode).toBe(0)

    // Only actionable sections appear
    expect(result.stdout).toContain("New Comments")
    expect(result.stdout).toContain("Replies")
    expect(result.stdout).not.toContain("Resolved")
    expect(result.stdout).not.toContain("Deleted")

    expect(result.stdout).toContain("fresh comment")
    expect(result.stdout).toContain("actually not resolved")
  })
})

describe("live interaction: thread popup state flow", () => {
  const SPEC = ["line one", "line two", "line three", "line four", "line five"]

  it("addOwnerReply + markRead + unreadCount cycle", () => {
    const state = new ReviewState(SPEC, [])

    // Add a comment
    state.addComment(1, "please fix this")
    const threadId = state.threads[0].id  // "t1"

    // Initially no unread
    expect(state.unreadCount()).toBe(0)
    expect(state.isThreadUnread(threadId)).toBe(false)

    // AI (owner) replies — creates unread
    state.addOwnerReply(threadId, "done", 1001)
    expect(state.unreadCount()).toBe(1)
    expect(state.isThreadUnread(threadId)).toBe(true)
    expect(state.threads[0].status).toBe("pending")

    // Popup opens, user reads — markRead
    state.markRead(threadId)
    expect(state.unreadCount()).toBe(0)
    expect(state.isThreadUnread(threadId)).toBe(false)

    // Another AI reply arrives
    state.addOwnerReply(threadId, "also this", 2000)
    expect(state.unreadCount()).toBe(1)
    expect(state.isThreadUnread(threadId)).toBe(true)
  })

  it("markRead does not affect other unread threads", () => {
    const state = new ReviewState(SPEC, [])

    state.addComment(1, "comment A")
    state.addComment(3, "comment B")
    const t1 = state.threads[0].id
    const t2 = state.threads[1].id

    state.addOwnerReply(t1, "reply A", 1001)
    state.addOwnerReply(t2, "reply B", 1002)
    expect(state.unreadCount()).toBe(2)

    // Mark t1 read — t2 stays unread
    state.markRead(t1)
    expect(state.unreadCount()).toBe(1)
    expect(state.isThreadUnread(t1)).toBe(false)
    expect(state.isThreadUnread(t2)).toBe(true)
  })

  it("addOwnerReply sets thread status to pending regardless of prior status", () => {
    const state = new ReviewState(SPEC, [])
    state.addComment(2, "fix me")
    const threadId = state.threads[0].id

    // Manually set to resolved
    state.resolveThread(threadId)
    expect(state.threads[0].status).toBe("resolved")

    // AI reply overrides to pending
    state.addOwnerReply(threadId, "actually addressed", 5000)
    expect(state.threads[0].status).toBe("pending")
  })

  it("unreadCount resets correctly when all threads marked read", () => {
    const state = new ReviewState(SPEC, [])
    state.addComment(1, "a")
    state.addComment(2, "b")
    state.addComment(3, "c")
    const ids = state.threads.map((t) => t.id)

    for (const id of ids) {
      state.addOwnerReply(id, "reply", 1000)
    }
    expect(state.unreadCount()).toBe(3)

    for (const id of ids) {
      state.markRead(id)
    }
    expect(state.unreadCount()).toBe(0)
  })
})

describe("live interaction: crash recovery via event replay", () => {
  let dir: string
  let specPath: string
  let jsonlPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "revspec-crash-"))
    specPath = join(dir, "spec.md")
    jsonlPath = join(dir, "spec.review.live.jsonl")
    writeFileSync(specPath, "# Spec\n\nContent here.\n")
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it("replaying events from JSONL restores thread state matching what was written", async () => {
    // Write a sequence of events (as if TUI was running)
    const events = [
      { type: "comment" as const, threadId: "t1", line: 3, author: "reviewer", text: "needs work", ts: 1000 },
      { type: "reply" as const, threadId: "t1", author: "owner", text: "working on it", ts: 2000 },
      { type: "reply" as const, threadId: "t1", author: "reviewer", text: "looks better", ts: 3000 },
      { type: "comment" as const, threadId: "t2", line: 1, author: "reviewer", text: "other issue", ts: 4000 },
      { type: "resolve" as const, threadId: "t1", author: "reviewer", ts: 5000 },
    ]

    for (const ev of events) {
      appendEvent(jsonlPath, ev)
    }

    // Simulate crash recovery: startup replays entire JSONL from byte 0
    const { events: replayed } = readEventsFromOffset(jsonlPath, 0)
    expect(replayed).toHaveLength(events.length)

    // Verify each event matches what was written
    for (let i = 0; i < events.length; i++) {
      expect(replayed[i].type).toBe(events[i].type)
      expect(replayed[i].author).toBe(events[i].author)
      expect(replayed[i].ts).toBe(events[i].ts)
      if ('text' in events[i]) {
        expect(replayed[i].text).toBe((events[i] as any).text)
      }
    }

    // Verify replayed state is correct
    const threads = replayEventsToThreads(replayed)
    expect(threads).toHaveLength(2)

    const t1 = threads.find((t) => t.id === "t1")!
    expect(t1).toBeDefined()
    expect(t1.status).toBe("resolved")
    expect(t1.messages).toHaveLength(3)
    expect(t1.messages[0].author).toBe("reviewer")
    expect(t1.messages[0].text).toBe("needs work")
    expect(t1.messages[1].author).toBe("owner")
    expect(t1.messages[2].author).toBe("reviewer")

    const t2 = threads.find((t) => t.id === "t2")!
    expect(t2).toBeDefined()
    expect(t2.status).toBe("open")
    expect(t2.messages).toHaveLength(1)
  })

  it("crash recovery: mergeJsonlIntoReview restores prior review + new JSONL events", async () => {
    // Prior round left a resolved thread (written to JSON)
    const priorReview = {
      file: specPath,
      threads: [{
        id: "t1", line: 3, status: "resolved" as const,
        messages: [
          { author: "reviewer" as const, text: "old issue", ts: 100 },
          { author: "owner" as const, text: "fixed", ts: 200 },
        ],
      }],
    }

    // New round JSONL has a new comment plus AI reply
    appendEvent(jsonlPath, { type: "comment", threadId: "t2", line: 1, author: "reviewer", text: "new round comment", ts: 5000 })
    appendEvent(jsonlPath, { type: "reply", threadId: "t2", author: "owner", text: "AI response", ts: 6000 })

    // Crash recovery: replay merges existing review with new JSONL
    const recovered = mergeJsonlIntoReview(jsonlPath, priorReview, specPath)
    expect(recovered.threads).toHaveLength(2)

    const recoveredT1 = recovered.threads.find((t) => t.id === "t1")!
    expect(recoveredT1.status).toBe("resolved")
    expect(recoveredT1.messages).toHaveLength(2)

    const recoveredT2 = recovered.threads.find((t) => t.id === "t2")!
    expect(recoveredT2.status).toBe("pending")
    expect(recoveredT2.messages).toHaveLength(2)
    expect(recoveredT2.messages[0].text).toBe("new round comment")
    expect(recoveredT2.messages[1].text).toBe("AI response")
  })

  it("crash recovery: truncated JSONL (mid-write) does not corrupt earlier events", async () => {
    // Write valid events
    appendEvent(jsonlPath, { type: "comment", threadId: "t1", line: 3, author: "reviewer", text: "valid", ts: 1000 })
    appendEvent(jsonlPath, { type: "reply", threadId: "t1", author: "owner", text: "valid reply", ts: 2000 })

    // Simulate crash mid-write: append a partial/malformed line
    const { appendFileSync } = await import("fs")
    appendFileSync(jsonlPath, '{"type":"reply","threadId":"t1","author":"owner","text":"interrupted')

    // Replay should recover the 2 valid events and discard the malformed line
    const { events } = readEventsFromOffset(jsonlPath, 0)
    expect(events).toHaveLength(2)

    const threads = replayEventsToThreads(events)
    expect(threads).toHaveLength(1)
    expect(threads[0].messages).toHaveLength(2)
    expect(threads[0].messages[0].text).toBe("valid")
    expect(threads[0].messages[1].text).toBe("valid reply")
  })
})

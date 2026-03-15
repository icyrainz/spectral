import { describe, test, expect, afterEach } from "bun:test";
import { createHarness, type TuiHarness } from "./harness";
import { resolve } from "path";

const SPEC = resolve(import.meta.dir, "fixtures/spec.md");

// Short wait for key processing, longer for sequences with timeout
const W = 80;   // normal key wait
const S = 350;  // sequence wait (gg/dd need 300ms timeout to resolve)

describe("revspec E2E snapshots", () => {
  let harness: TuiHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.quit();
      harness = null;
    }
  });

  // --- Navigation ---

  test("initial render", async () => {
    harness = await createHarness(SPEC);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("scroll to bottom with G", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("G");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("scroll to top with gg", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("G");
    await harness.wait(W);
    harness.sendKeys("gg");
    await harness.wait(S);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("cursor movement j/k", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjjjj");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("half page down Ctrl+D", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("\x04"); // Ctrl+D
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("half page up Ctrl+U", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("G");
    await harness.wait(W);
    harness.sendKeys("\x15"); // Ctrl+U
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Search ---

  test("search highlights", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search next with n", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(W);
    harness.sendKeys("n");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search clear with Esc", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search cancel with Esc in search bar", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc without entering query
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Overlays ---

  test("help overlay", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("help overlay dismiss with q", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("help overlay scroll j/k", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(W);
    harness.sendKeys("jjjjjjjjjjjjjjj");
    await harness.wait(W);
    // Use contains() instead of snapshot — help overlay text wraps
    // differently after scrolling across terminal environments
    expect(harness.contains("Review")).toBe(true);
    expect(harness.contains("Resolve thread")).toBe(true);
    expect(harness.contains("Delete thread")).toBe(true);
  });

  // --- Comment / Thread ---

  test("comment input opens on c", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj"); // move to line 4
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input type and submit", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    // Type a comment (already in insert mode)
    harness.sendKeys("This is a test comment");
    await harness.wait(W);
    // Submit with Tab
    harness.sendKeys("\t");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input switch to normal mode", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc to normal mode
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input close with q in normal mode", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc to normal
    await harness.wait(W);
    harness.sendKeys("q"); // close
    await harness.wait(W);
    // Should be back to pager
    expect(harness.capture()).toMatchSnapshot();
  });

  test("thread indicator after comment", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Test thread comment\t"); // type + Tab to submit
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc to normal
    await harness.wait(W);
    harness.sendKeys("q"); // close popup
    await harness.wait(W);
    // Pager should show gutter indicator on line 4
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Thread list ---

  test("thread list empty", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("T");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("thread list with threads", async () => {
    harness = await createHarness(SPEC);
    // Create a thread first
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Comment for thread list test\t");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // normal
    await harness.wait(W);
    harness.sendKeys("q"); // close comment
    await harness.wait(W);
    // Open thread list
    harness.sendKeys("T");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Resolve ---

  test("resolve thread with r", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Comment to resolve\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // Resolve it
    harness.sendKeys("r");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Delete thread ---

  test("delete thread with dd shows confirm", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Comment to delete\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // dd to delete
    harness.sendKeys("dd");
    await harness.wait(S);
    // Confirm dialog should be visible
    expect(harness.capture()).toMatchSnapshot();
  });

  test("delete thread confirm with y", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Comment to delete\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // dd + y to confirm delete
    harness.sendKeys("dd");
    await harness.wait(S);
    harness.sendKeys("y");
    await harness.wait(W);
    // Thread should be gone
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Command mode ---

  test("command mode :w", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys(":w\n");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("command mode escape cancels", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys(":abc");
    await harness.wait(W);
    harness.sendKeys("\x1b"); // Esc
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Context-sensitive bottom bar ---

  test("bottom bar shows thread hints on thread line", async () => {
    harness = await createHarness(SPEC);
    // Create a thread
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Thread hint test\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // Cursor should be on the thread line — bottom bar should show [r] resolve
    expect(harness.contains("resolve")).toBe(true);
  });

  test("bottom bar hides thread hints on non-thread line", async () => {
    harness = await createHarness(SPEC);
    // No thread at line 1 — bottom bar should NOT show resolve/delete
    const screen = harness.capture();
    // The bottom line should have navigate/comment/help but not resolve
    const lines = screen.split("\n");
    const bottomLine = lines[lines.length - 1] || "";
    expect(bottomLine).toContain("navigate");
    expect(bottomLine).toContain("comment");
    expect(bottomLine).not.toContain("resolve");
  });

  // --- Approve ---

  test("approve blocked without threads", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("a");
    await harness.wait(W);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("approve blocked with open threads", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("Blocking thread\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // Try approve
    harness.sendKeys("a");
    await harness.wait(W);
    expect(harness.contains("still open")).toBe(true);
  });

  // --- Thread navigation ---

  test("]t navigates to next thread", async () => {
    harness = await createHarness(SPEC);
    // Create thread on line 4
    harness.sendKeys("jjj");
    await harness.wait(W);
    harness.sendKeys("c");
    await harness.wait(W);
    harness.sendKeys("First thread\t");
    await harness.wait(W);
    harness.sendKeys("\x1b");
    await harness.wait(W);
    harness.sendKeys("q");
    await harness.wait(W);
    // Go to top
    harness.sendKeys("gg");
    await harness.wait(S);
    // Navigate to next thread
    harness.sendKeys("]t");
    await harness.wait(S);
    // Should jump to the thread line
    expect(harness.capture()).toMatchSnapshot();
  });
});

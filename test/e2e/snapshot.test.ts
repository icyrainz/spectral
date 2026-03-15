import { describe, test, expect, afterEach } from "bun:test";
import { createHarness, type TuiHarness } from "./harness";
import { resolve } from "path";

const SPEC = resolve(import.meta.dir, "fixtures/spec.md");

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
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("scroll to top with gg", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("G");
    await harness.wait(200);
    harness.sendKeys("gg");
    await harness.wait(400);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("cursor movement j/k", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjjjj");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("half page down Ctrl+D", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("\x04"); // Ctrl+D
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("half page up Ctrl+U", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("G");
    await harness.wait(200);
    harness.sendKeys("\x15"); // Ctrl+U
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Search ---

  test("search highlights", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search next with n", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(200);
    harness.sendKeys("n");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search clear with Esc", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/token\n");
    await harness.wait(200);
    harness.sendKeys("\x1b"); // Esc
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("search cancel with Esc in search bar", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("/");
    await harness.wait(200);
    harness.sendKeys("\x1b"); // Esc without entering query
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Overlays ---

  test("help overlay", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("help overlay dismiss with q", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(300);
    harness.sendKeys("q");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("help overlay scroll j/k", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("?");
    await harness.wait(300);
    harness.sendKeys("jjjjj");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Comment / Thread ---

  test("comment input opens on c", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj"); // move to line 4
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input type and submit", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    // Type a comment (already in insert mode)
    harness.sendKeys("This is a test comment");
    await harness.wait(200);
    // Submit with Tab
    harness.sendKeys("\t");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input switch to normal mode", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("\x1b"); // Esc to normal mode
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("comment input close with q in normal mode", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("\x1b"); // Esc to normal
    await harness.wait(200);
    harness.sendKeys("q"); // close
    await harness.wait(300);
    // Should be back to pager
    expect(harness.capture()).toMatchSnapshot();
  });

  test("thread indicator after comment", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Test thread comment\t"); // type + Tab to submit
    await harness.wait(300);
    harness.sendKeys("\x1b"); // Esc to normal
    await harness.wait(200);
    harness.sendKeys("q"); // close popup
    await harness.wait(300);
    // Pager should show gutter indicator on line 4
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Thread list ---

  test("thread list empty", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("l");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("thread list with threads", async () => {
    harness = await createHarness(SPEC);
    // Create a thread first
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Comment for thread list test\t");
    await harness.wait(300);
    harness.sendKeys("\x1b"); // normal
    await harness.wait(200);
    harness.sendKeys("q"); // close comment
    await harness.wait(300);
    // Open thread list
    harness.sendKeys("l");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Resolve ---

  test("resolve thread with r", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Comment to resolve\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // Resolve it
    harness.sendKeys("r");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Delete thread ---

  test("delete thread with dd shows confirm", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Comment to delete\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // dd to delete
    harness.sendKeys("dd");
    await harness.wait(400);
    // Confirm dialog should be visible
    expect(harness.capture()).toMatchSnapshot();
  });

  test("delete thread confirm with y", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Comment to delete\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // dd + y to confirm delete
    harness.sendKeys("dd");
    await harness.wait(400);
    harness.sendKeys("y");
    await harness.wait(300);
    // Thread should be gone
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Command mode ---

  test("command mode :w", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys(":w\n");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("command mode escape cancels", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys(":abc");
    await harness.wait(200);
    harness.sendKeys("\x1b"); // Esc
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  // --- Context-sensitive bottom bar ---

  test("bottom bar shows thread hints on thread line", async () => {
    harness = await createHarness(SPEC);
    // Create a thread
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Thread hint test\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // Cursor should be on the thread line — bottom bar should show [r] resolve [dd] delete
    expect(harness.contains("resolve")).toBe(true);
    expect(harness.contains("delete")).toBe(true);
  });

  test("bottom bar hides thread hints on non-thread line", async () => {
    harness = await createHarness(SPEC);
    // No thread at line 1 — bottom bar should NOT show resolve/delete
    const screen = harness.capture();
    // The bottom line should have move/comment/search/help but not resolve/delete
    const lines = screen.split("\n");
    const bottomLine = lines[lines.length - 1] || "";
    expect(bottomLine).toContain("move");
    expect(bottomLine).toContain("comment");
    expect(bottomLine).not.toContain("resolve");
    expect(bottomLine).not.toContain("delete");
  });

  // --- Approve ---

  test("approve blocked without threads", async () => {
    harness = await createHarness(SPEC);
    harness.sendKeys("a");
    await harness.wait(300);
    expect(harness.capture()).toMatchSnapshot();
  });

  test("approve blocked with open threads", async () => {
    harness = await createHarness(SPEC);
    // Create thread
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("Blocking thread\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // Try approve
    harness.sendKeys("a");
    await harness.wait(300);
    expect(harness.contains("still open")).toBe(true);
  });

  // --- Thread navigation ---

  test("]t navigates to next thread", async () => {
    harness = await createHarness(SPEC);
    // Create thread on line 4
    harness.sendKeys("jjj");
    await harness.wait(200);
    harness.sendKeys("c");
    await harness.wait(300);
    harness.sendKeys("First thread\t");
    await harness.wait(300);
    harness.sendKeys("\x1b");
    await harness.wait(200);
    harness.sendKeys("q");
    await harness.wait(300);
    // Go to top
    harness.sendKeys("gg");
    await harness.wait(400);
    // Navigate to next thread
    harness.sendKeys("]t");
    await harness.wait(400);
    // Should jump to the thread line
    expect(harness.capture()).toMatchSnapshot();
  });
});

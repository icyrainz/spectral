import { spawn, type IPty } from "bun-pty";
import { resolve, dirname, basename, join } from "path";
import { unlinkSync, existsSync } from "fs";

const CLI = resolve(import.meta.dir, "../../bin/revspec.ts");

// Strip ANSI escape sequences and terminal control sequences
function stripAnsi(str: string): string {
  return str
    .replace(/\x1bP(?:[^\x1b]|\x1b[^\\])*\x1b\\/g, "") // DCS sequences (tmux passthrough etc)
    .replace(/\x1b\[[0-9;?>=!]*[ -/]*[A-Za-z@`~]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC sequences
    .replace(/\x1b[()][0-9A-Z]/g, "")          // Character set
    .replace(/\x1b[>=<]/g, "")                  // Mode changes
    .replace(/\x1b./g, "")                      // Any remaining ESC+char
    .replace(/\r/g, "")                         // Carriage returns
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "YYYY-MM-DD HH:MM:SS") // Normalize timestamps
    .replace(/revspec v\d+\.\d+\.\d+/g, "revspec vX.Y.Z"); // Normalize version
}

export interface TuiHarness {
  sendKeys: (keys: string) => void;
  wait: (ms?: number) => Promise<void>;
  capture: () => string;
  /** Check if captured output contains text (plain text, ANSI stripped) */
  contains: (text: string) => boolean;
  quit: () => Promise<void>;
  /** Clean up review files created during the test */
  cleanReviewFiles: () => void;
}

export async function createHarness(specFile: string, opts?: { cols?: number; rows?: number }): Promise<TuiHarness> {
  const cols = opts?.cols ?? 80;
  const rows = opts?.rows ?? 24;

  const specPath = resolve(specFile);

  let buffer = "";

  const pty = spawn("bun", ["run", CLI, specPath], {
    name: "xterm-256color",
    cols,
    rows,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      NO_COLOR: undefined,
      FORCE_COLOR: undefined,
    },
  });

  pty.onData((data: string) => {
    buffer += data;
  });

  function sendKeys(keys: string): void {
    pty.write(keys);
  }

  function wait(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function capture(): string {
    const raw = buffer;
    const clean = stripAnsi(raw);
    // The alternate screen content is the last screen of output
    // Split by lines and take the last `rows` lines
    const lines = clean.split("\n");
    const screen = lines.slice(Math.max(0, lines.length - rows), lines.length);
    return screen.join("\n").trimEnd();
  }

  function contains(text: string): boolean {
    return capture().includes(text);
  }

  function cleanReviewFiles(): void {
    const dir = dirname(specPath);
    const base = basename(specPath, ".md");
    const files = [
      join(dir, `${base}.review.json`),
      join(dir, `${base}.review.live.jsonl`),
      join(dir, `${base}.review.live.offset`),
      join(dir, `${base}.review.live.lock`),
      join(dir, `${base}.review.draft.json`),
    ];
    for (const f of files) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }

  async function quit(): Promise<void> {
    sendKeys("\x1b"); // Esc first to clear any state
    await wait(50);
    sendKeys(":q!\n");
    await wait(200);
    try {
      pty.kill();
    } catch {}
    cleanReviewFiles();
  }

  // Wait for initial render
  await wait(300);

  return { sendKeys, wait, capture, contains, quit, cleanReviewFiles };
}

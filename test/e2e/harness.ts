import { spawn, type IPty } from "bun-pty";
import { resolve, dirname, basename, join } from "path";
import { unlinkSync, existsSync } from "fs";

const CLI = resolve(import.meta.dir, "../../bin/revspec.ts");

function stripAnsi(str: string): string {
  return str
    .replace(/\x1bP(?:[^\x1b]|\x1b[^\\])*\x1b\\/g, "")
    .replace(/\x1b\[[0-9;?>=!]*[ -/]*[A-Za-z@`~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][0-9A-Z]/g, "")
    .replace(/\x1b[>=<]/g, "")
    .replace(/\x1b./g, "")
    .replace(/\r/g, "")
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "YYYY-MM-DD HH:MM:SS")
    .replace(/revspec v\d+\.\d+\.\d+/g, "revspec vX.Y.Z")
    .replace(/#[0-9a-z]{6,10}/g, "#THREADID"); // Normalize nanoid thread IDs
}

export interface TuiHarness {
  sendKeys: (keys: string) => void;
  wait: (ms?: number) => Promise<void>;
  capture: () => string;
  contains: (text: string) => boolean;
  quit: () => Promise<void>;
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
    env: { ...process.env, TERM: "xterm-256color", NO_COLOR: undefined, FORCE_COLOR: undefined },
  });

  pty.onData((data: string) => { buffer += data; });

  function sendKeys(keys: string): void { pty.write(keys); }

  function wait(ms = 50): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function capture(): string {
    const clean = stripAnsi(buffer);
    const lines = clean.split("\n");
    return lines.slice(Math.max(0, lines.length - rows), lines.length).join("\n").trimEnd();
  }

  function contains(text: string): boolean { return capture().includes(text); }

  function cleanReviewFiles(): void {
    const dir = dirname(specPath);
    const base = basename(specPath, ".md");
    for (const ext of [".review.json", ".review.live.jsonl", ".review.live.offset", ".review.live.lock", ".review.draft.json"]) {
      const f = join(dir, `${base}${ext}`);
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }

  async function quit(): Promise<void> {
    sendKeys("\x1b");
    await wait(30);
    sendKeys(":q!\n");
    await wait(100);
    try { pty.kill(); } catch {}
    cleanReviewFiles();
  }

  // Wait for initial render
  await wait(150);

  return { sendKeys, wait, capture, contains, quit, cleanReviewFiles };
}

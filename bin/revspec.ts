#!/usr/bin/env bun
import { existsSync } from "fs";
import { resolve, basename, extname, dirname, join } from "path";
import { runTui } from "../src/tui/app";

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === "watch") {
  const specFile = args[1];
  if (!specFile) {
    console.error("Usage: revspec watch <file.md>");
    process.exit(1);
  }
  const { runWatch } = await import("../src/cli/watch");
  await runWatch(specFile);
  process.exit(0);
}

if (subcommand === "reply") {
  const specFile = args[1];
  const threadId = args[2];
  const text = args[3];
  if (!specFile || !threadId || !text) {
    console.error('Usage: revspec reply <file.md> <threadId> "<text>"');
    process.exit(1);
  }
  const { runReply } = await import("../src/cli/reply");
  runReply(specFile, threadId, text);
  process.exit(0);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: revspec <file.md> [--tui|--nvim|--web]");
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  console.log(`revspec ${pkg.version}`);
  process.exit(0);
}

const specFile = args.find((a) => !a.startsWith("--"));
if (!specFile) {
  console.error("Error: No spec file provided");
  process.exit(1);
}

// 1. Validate spec file exists
const specPath = resolve(specFile);
if (!existsSync(specPath)) {
  console.error(`Error: Spec file not found: ${specPath}`);
  process.exit(1);
}

// 2. Launch TUI
const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
await runTui(specPath, pkg.version);

process.exit(0);

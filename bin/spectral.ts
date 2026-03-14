#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: spectral <file.md> [--tui|--nvim|--web]");
  process.exit(0);
}
const specFile = args.find((a) => !a.startsWith("--"));
if (!specFile) {
  console.error("Error: No spec file provided");
  process.exit(1);
}
console.log(`spectral: would review ${specFile}`);

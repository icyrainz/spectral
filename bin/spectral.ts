#!/usr/bin/env bun
import { existsSync, unlinkSync, readFileSync } from "fs";
import { resolve, basename, extname, dirname, join } from "path";
import { readReviewFile, readDraftFile } from "../src/protocol/read";
import { writeReviewFile } from "../src/protocol/write";
import { mergeDraftIntoReview } from "../src/protocol/merge";
import { runTui } from "../src/tui/app";

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

// 1. Validate spec file exists
const specPath = resolve(specFile);
if (!existsSync(specPath)) {
  console.error(`Error: Spec file not found: ${specPath}`);
  process.exit(1);
}

// 2. Derive review/draft paths from spec filename
//    e.g. spec.md -> spec.review.json, spec.review.draft.json
const specDir = dirname(specPath);
const specBase = basename(specPath, extname(specPath)); // e.g. "spec"
const reviewPath = join(specDir, `${specBase}.review.json`);
const draftPath = join(specDir, `${specBase}.review.draft.json`);

// 3. Check for corrupted draft — if exists but invalid JSON, warn and delete
if (existsSync(draftPath)) {
  let raw: string;
  try {
    raw = readFileSync(draftPath, "utf8");
  } catch {
    raw = "";
  }
  let parsedDraft: unknown = null;
  let parseError = false;
  try {
    parsedDraft = JSON.parse(raw);
    if (typeof parsedDraft !== "object" || parsedDraft === null) {
      parseError = true;
    }
  } catch {
    parseError = true;
  }
  if (parseError) {
    process.stderr.write(
      `Warning: Draft file is corrupted (invalid JSON), deleting: ${draftPath}\n`
    );
    unlinkSync(draftPath);
  }
}

// 4. Launch TUI (skip if SPECTRAL_SKIP_TUI=1)
if (process.env.SPECTRAL_SKIP_TUI !== "1") {
  await runTui(specPath, reviewPath, draftPath);
}

// 5. After TUI exits, read draft
if (existsSync(draftPath)) {
  const draft = readDraftFile(draftPath);

  if (draft && draft.approved === true) {
    // Approved — delete draft, print APPROVED, exit 0
    unlinkSync(draftPath);
    process.stdout.write(`APPROVED: ${reviewPath}\n`);
    process.exit(0);
  }

  if (draft && draft.threads && draft.threads.length > 0) {
    // Has threads — merge into review file, delete draft
    const existingReview = readReviewFile(reviewPath);
    const merged = mergeDraftIntoReview(existingReview, draft, specPath);
    writeReviewFile(reviewPath, merged);
    unlinkSync(draftPath);

    // Output review path — draft had threads, so new comments were added
    process.stdout.write(`${reviewPath}\n`);
    process.exit(0);
  }
}

// 6. No draft (or draft had no threads and wasn't approved)
//    Check if existing review file has open/pending threads
const existingReview = readReviewFile(reviewPath);
if (existingReview) {
  const hasOpenOrPending = existingReview.threads.some(
    (t) => t.status === "open" || t.status === "pending"
  );
  if (hasOpenOrPending) {
    process.stdout.write(`${reviewPath}\n`);
  }
}

// Otherwise print nothing
process.exit(0);

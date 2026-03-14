import { readFileSync } from "fs";
import type { ReviewFile, DraftFile } from "./types";
import { isValidReviewFile } from "./types";

export function readReviewFile(path: string): ReviewFile | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidReviewFile(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readDraftFile(path: string): DraftFile | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DraftFile;
  } catch {
    return null;
  }
}

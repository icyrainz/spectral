import { writeFileSync } from "fs";
import type { ReviewFile, DraftFile } from "./types";

export function writeReviewFile(path: string, review: ReviewFile): void {
  writeFileSync(path, JSON.stringify(review, null, 2), "utf8");
}

export function writeDraftFile(path: string, draft: DraftFile): void {
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
}

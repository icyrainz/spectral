export type Status = "open" | "pending" | "resolved" | "outdated";

export interface Message {
  author: "reviewer" | "owner";
  text: string;
  ts?: number;
}

export interface Thread {
  id: string;
  line: number;
  status: Status;
  messages: Message[];
}

export interface ReviewFile {
  file: string;
  threads: Thread[];
}

export interface DraftFile {
  approved?: boolean;
  threads?: Thread[];
}

const VALID_STATUSES: readonly string[] = [
  "open",
  "pending",
  "resolved",
  "outdated",
];

export function isValidStatus(value: unknown): value is Status {
  return typeof value === "string" && VALID_STATUSES.includes(value);
}

export function isValidThread(value: unknown): value is Thread {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.line === "number" &&
    isValidStatus(v.status) &&
    Array.isArray(v.messages)
  );
}

export function isValidReviewFile(value: unknown): value is ReviewFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.file === "string" &&
    Array.isArray(v.threads) &&
    (v.threads as unknown[]).every(isValidThread)
  );
}

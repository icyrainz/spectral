import { watch, existsSync, statSync } from "fs"
import { readEventsFromOffset, type LiveEvent } from "../protocol/live-events"

export interface LiveWatcher {
  start(): void
  stop(): void
}

export function createLiveWatcher(
  jsonlPath: string,
  onOwnerEvents: (events: LiveEvent[]) => void
): LiveWatcher {
  let offset = existsSync(jsonlPath) ? statSync(jsonlPath).size : 0
  let fsWatcher: ReturnType<typeof watch> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function check() {
    const { events, newOffset } = readEventsFromOffset(jsonlPath, offset)
    if (events.length > 0) {
      offset = newOffset
      const ownerEvents = events.filter((e) => e.author === "owner")
      if (ownerEvents.length > 0) {
        onOwnerEvents(ownerEvents)
      }
    }
  }

  return {
    start() {
      try {
        fsWatcher = watch(jsonlPath, () => check())
      } catch {}
      pollTimer = setInterval(check, 500)
    },
    stop() {
      if (fsWatcher) { fsWatcher.close(); fsWatcher = null }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    },
  }
}

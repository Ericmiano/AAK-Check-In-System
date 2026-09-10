const STORAGE_KEY = "aak-checkin-pending-queue";

export type PendingCheckIn = {
  id: string;
  lookup: string;
  queuedAt: number;
};

function readQueue(): PendingCheckIn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingCheckIn[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: PendingCheckIn[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable (private mode, full quota): the queue just won't
    // survive a reload, but check-in still works for the current tab.
  }
}

/** Saves a failed check-in lookup so it can be retried once back online. */
export function enqueueCheckIn(lookup: string): PendingCheckIn {
  const entry: PendingCheckIn = { id: crypto.randomUUID(), lookup, queuedAt: Date.now() };
  writeQueue([...readQueue(), entry]);
  return entry;
}

export function getQueue(): PendingCheckIn[] {
  return readQueue();
}

export function removeFromQueue(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

/**
 * Best-effort check for "this failed because the network is down" rather
 * than "the server rejected this request". navigator.onLine catches the
 * common case instantly; the message check catches flaky connections that
 * still report as online but fail the actual request.
 */
export function isLikelyNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network/i.test(message);
}

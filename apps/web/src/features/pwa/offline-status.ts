export interface OfflineStatus {
  online: boolean;
  observedAt: string;
  lastTurnStatus: string | null;
}

const STORAGE_KEY = "codex-remote:offline-status:v1";
const ALLOWED_KEYS = new Set(["online", "observedAt", "lastTurnStatus"]);

export function saveOfflineStatus(status: OfflineStatus): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const serialized = JSON.stringify(status);
  if (serialized.length > 1_024) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, serialized);
}

export function loadOfflineStatus(): OfflineStatus | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw || raw.length > 1_024) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isOfflineStatus(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function isOfflineStatus(value: unknown): value is OfflineStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_KEYS.has(key))) {
    return false;
  }
  return (
    Object.keys(record).length === 3 &&
    typeof record.online === "boolean" &&
    typeof record.observedAt === "string" &&
    !Number.isNaN(Date.parse(record.observedAt)) &&
    (record.lastTurnStatus === null ||
      (typeof record.lastTurnStatus === "string" &&
        record.lastTurnStatus.length <= 50))
  );
}

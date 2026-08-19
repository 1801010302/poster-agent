const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function beijingDayKey(timestamp = Date.now()): string {
  return new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function beijingDayStart(timestamp = Date.now()): number {
  const shifted = new Date(timestamp + BEIJING_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BEIJING_OFFSET_MS;
}

export function recentBeijingDayKeys(days: number, timestamp = Date.now()): string[] {
  const start = beijingDayStart(timestamp);
  return Array.from({ length: days }, (_, index) => beijingDayKey(start - (days - index - 1) * 24 * 60 * 60 * 1000));
}

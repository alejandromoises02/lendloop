const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Inclusive ranges [aStart, aEnd] and [bStart, bEnd] overlap. ISO strings compare lexically. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const MAX_LOAN_DAYS = 30;

/**
 * Returns an error code, or null when the range is valid for a new request.
 * `today` is the server's UTC date; one day of slack lets users west of UTC
 * request "today" in the evening, when UTC has already moved on.
 */
export function validateRequestRange(startDate: string, endDate: string, today: string): string | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return "INVALID_DATE";
  if (startDate < addDays(today, -1)) return "START_IN_PAST";
  if (endDate < startDate) return "END_BEFORE_START";
  if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) return "RANGE_TOO_LONG";
  return null;
}

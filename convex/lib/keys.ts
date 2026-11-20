/** Idempotency keys: one per logical automation event, stable across retries. */
export function overdueReminderKey(loanId: string, day: string): string {
  return `overdue_reminder:${loanId}:${day}`;
}

export function requestNotificationKey(loanId: string, status: string): string {
  return `request_notification:${loanId}:${status}`;
}

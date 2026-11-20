"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { StatusBadge } from "./StatusBadge";

export type LoanRow = FunctionReturnType<typeof api.loans.myRequests>[number];

const KIND_LABEL: Record<string, string> = {
  request_notification: "Notification",
  overdue_reminder: "Reminder",
  workflow_error: "Automation error",
};

function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function LoanList({
  loans,
  counterpart,
  actions,
  empty,
}: {
  loans: LoanRow[] | undefined;
  counterpart: "owner" | "borrower" | "both";
  actions?: (loan: LoanRow) => React.ReactNode;
  empty: string;
}) {
  if (loans === undefined) return <p className="text-sm text-stone-500">Loading…</p>;
  if (loans.length === 0) return <p className="card text-sm text-stone-500">{empty}</p>;

  return (
    <ul className="grid gap-3">
      {loans.map((loan) => (
        <li key={loan._id} className="card flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium">{loan.toolName}</p>
            <p className="text-sm text-stone-600">
              {loan.startDate} → {loan.endDate}
              {counterpart !== "borrower" && <> · Lender: {loan.ownerName}</>}
              {counterpart !== "owner" && <> · Borrower: {loan.borrowerName}</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={loan.status} />
              {loan.overdue && <StatusBadge status="overdue" />}
            </div>
            {loan.automation.length > 0 && (
              <ul className="text-xs text-stone-500">
                {loan.automation.map((a, i) => (
                  <li key={i}>
                    {KIND_LABEL[a.kind]} {a.status === "sent" ? "sent" : "failed"} {timeAgo(a.at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {actions && <div className="flex gap-2">{actions(loan)}</div>}
        </li>
      ))}
    </ul>
  );
}

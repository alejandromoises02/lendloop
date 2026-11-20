"use client";

import { useMutation, useQuery } from "convex/react";
import { EnsureUser } from "@/components/EnsureUser";
import { LoanList } from "@/components/LoanList";
import { useSafeRun } from "@/components/useSafeRun";
import { api } from "../../../convex/_generated/api";

function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { error, run } = useSafeRun();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My requests</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <LoanList
        loans={loans}
        counterpart="owner"
        empty="You haven't requested anything yet."
        actions={(loan) => (
          <>
            {loan.status === "pending" && (
              <button className="btn-secondary" onClick={() => run(() => cancel({ loanId: loan._id }))}>Withdraw</button>
            )}
            {loan.status === "approved" && (
              <button className="btn-secondary" onClick={() => run(() => markReturned({ loanId: loan._id }))}>Mark returned</button>
            )}
          </>
        )}
      />
    </div>
  );
}

export default function RequestsPage() {
  return (
    <EnsureUser>
      <MyRequests />
    </EnsureUser>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { EnsureUser } from "@/components/EnsureUser";
import { LoanList } from "@/components/LoanList";
import { useSafeRun } from "@/components/useSafeRun";
import { api } from "../../../convex/_generated/api";

function Incoming() {
  const loans = useQuery(api.loans.incoming);
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { error, run } = useSafeRun();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Incoming requests</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <LoanList
        loans={loans}
        counterpart="borrower"
        empty="No one has asked to borrow your tools yet."
        actions={(loan) => (
          <>
            {loan.status === "pending" && (
              <>
                <button className="btn-primary" onClick={() => run(() => decide({ loanId: loan._id, decision: "approved" }))}>Approve</button>
                <button className="btn-secondary" onClick={() => run(() => decide({ loanId: loan._id, decision: "declined" }))}>Decline</button>
              </>
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

export default function IncomingPage() {
  return (
    <EnsureUser>
      <Incoming />
    </EnsureUser>
  );
}

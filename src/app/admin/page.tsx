"use client";

import { useMutation, useQuery } from "convex/react";
import { EnsureUser } from "@/components/EnsureUser";
import { LoanList } from "@/components/LoanList";
import { StatusBadge } from "@/components/StatusBadge";
import { useSafeRun } from "@/components/useSafeRun";
import { CATEGORY_LABEL } from "@/lib/labels";
import { api } from "../../../convex/_generated/api";

function Admin() {
  const me = useQuery(api.users.me);
  const isAdmin = me?.role === "admin";
  // Skip admin queries for non-admins; the server would reject them anyway.
  const users = useQuery(api.users.listForAdmin, isAdmin ? {} : "skip");
  const loans = useQuery(api.loans.all, isAdmin ? {} : "skip");
  const tools = useQuery(api.tools.list, isAdmin ? {} : "skip");
  const failures = useQuery(api.automation.recentFailures, isAdmin ? {} : "skip");
  const setTrusted = useMutation(api.users.setTrustedLender);
  const removeTool = useMutation(api.tools.remove);
  const { error, run } = useSafeRun();

  if (me === undefined) return <p className="text-sm text-stone-500">Loading…</p>;
  if (!isAdmin) return <p className="card text-sm text-stone-600">This area is only available to admins.</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Automation failures</h2>
        {failures === undefined ? null : failures.length === 0 ? (
          <p className="card text-sm text-stone-500">No failed automation runs.</p>
        ) : (
          <ul className="card divide-y divide-stone-100 text-sm">
            {failures.map((f) => (
              <li key={f._id} className="py-2">
                <span className="font-medium">{f.kind.replace("_", " ")}</span> · {new Date(f.at).toLocaleString()} · {f.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Lenders</h2>
        <ul className="card divide-y divide-stone-100">
          {users?.map((u) => (
            <li key={u._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {u.name} <span className="text-stone-500">{u.email}</span>
                {u.role === "admin" && <span className="ml-2 text-xs text-stone-500">(admin)</span>}
              </span>
              <button className={u.trustedLender ? "btn-secondary" : "btn-primary"} onClick={() => run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}>
                {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All listings</h2>
        <ul className="card divide-y divide-stone-100">
          {tools?.map((t) => (
            <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {t.name} <span className="text-stone-500">· {CATEGORY_LABEL[t.category]} · {t.ownerName}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={t.availability} />
                <button className="btn-danger" onClick={() => confirm(`Remove "${t.name}"?`) && run(() => removeTool({ toolId: t._id }))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All loans</h2>
        <LoanList loans={loans} counterpart="both" empty="No loans yet." />
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <EnsureUser>
      <Admin />
    </EnsureUser>
  );
}

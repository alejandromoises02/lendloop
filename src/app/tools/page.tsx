"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { EnsureUser } from "@/components/EnsureUser";
import { StatusBadge } from "@/components/StatusBadge";
import { errorMessage } from "@/lib/errors";
import { CATEGORIES, CATEGORY_LABEL, CONDITION_LABEL, type Category } from "@/lib/labels";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const [startDate, setStart] = useState(today());
  const [endDate, setEnd] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await request({ toolId, startDate, endDate });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-stone-100 pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`start-${toolId}`}>From</label>
          <input id={`start-${toolId}`} type="date" className="input" min={today()} value={startDate} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor={`end-${toolId}`}>To</label>
          <input id={`end-${toolId}`} type="date" className="input" min={startDate} value={endDate} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={sending}>{sending ? "Sending…" : "Send request"}</button>
        <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function Catalog() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const [openId, setOpenId] = useState<Id<"tools"> | null>(null);
  const [sentId, setSentId] = useState<Id<"tools"> | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">All tools</h1>
        <div>
          <label className="label" htmlFor="category-filter">Category</label>
          <select id="category-filter" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
      </div>

      {tools === undefined ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="card text-sm text-stone-500">No tools in this category yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-stone-500">
                    {CATEGORY_LABEL[t.category]} · {CONDITION_LABEL[t.condition]}
                  </p>
                </div>
                <StatusBadge status={t.availability} />
              </div>
              <p className="mt-2 text-sm text-stone-700">{t.description}</p>
              <p className="mt-2 text-xs text-stone-500">
                Lent by {t.isMine ? "you" : t.ownerName}
                {t.ownerTrusted && <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">Trusted Lender</span>}
              </p>
              {!t.isMine &&
                (openId === t._id ? (
                  <RequestForm toolId={t._id} onDone={() => { setOpenId(null); setSentId(t._id); }} />
                ) : (
                  <div className="mt-3 flex items-center gap-3">
                    <button className="btn-secondary" onClick={() => { setOpenId(t._id); setSentId(null); }}>Request to borrow</button>
                    {sentId === t._id && <span className="text-sm text-brand-700">Request sent</span>}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ToolsPage() {
  return (
    <EnsureUser>
      <Catalog />
    </EnsureUser>
  );
}

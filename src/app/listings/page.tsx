"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { EnsureUser } from "@/components/EnsureUser";
import { StatusBadge } from "@/components/StatusBadge";
import { ToolForm } from "@/components/ToolForm";
import { errorMessage } from "@/lib/errors";
import { CATEGORY_LABEL, CONDITION_LABEL } from "@/lib/labels";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function MyListings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove(toolId: Id<"tools">) {
    if (!confirm("Delete this listing?")) return;
    setError(null);
    try {
      await remove({ toolId });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My listings</h1>

      <section className="card space-y-3" aria-labelledby="new-tool">
        <h2 id="new-tool" className="font-semibold">List a tool</h2>
        <ToolForm submitLabel="List tool" onSubmit={(v) => create(v)} />
      </section>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {tools === undefined ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="card text-sm text-stone-500">You haven&apos;t listed anything yet.</p>
      ) : (
        <ul className="grid gap-3">
          {tools.map((t) => (
            <li key={t._id} className="card">
              {editing === t._id ? (
                <ToolForm
                  initial={{ name: t.name, category: t.category, condition: t.condition, description: t.description }}
                  submitLabel="Save changes"
                  onSubmit={async (v) => {
                    await update({ toolId: t._id, ...v });
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-sm text-stone-500">{CATEGORY_LABEL[t.category]} · {CONDITION_LABEL[t.condition]}</p>
                    <p className="mt-1 text-sm text-stone-700">{t.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={t.availability} />
                    <button className="btn-secondary" onClick={() => setEditing(t._id)}>Edit</button>
                    <button className="btn-danger" onClick={() => handleRemove(t._id)}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ListingsPage() {
  return (
    <EnsureUser>
      <MyListings />
    </EnsureUser>
  );
}

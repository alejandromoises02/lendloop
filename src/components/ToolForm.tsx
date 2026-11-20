"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, CONDITIONS, CONDITION_LABEL, type Category, type Condition } from "@/lib/labels";
import { errorMessage } from "@/lib/errors";

export type ToolInput = { name: string; category: Category; condition: Condition; description: string };

const EMPTY: ToolInput = { name: "", category: "power_tools", condition: "good", description: "" };

export function ToolForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ToolInput;
  submitLabel: string;
  onSubmit: (value: ToolInput) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<ToolInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(value);
      if (initial === EMPTY) setValue(EMPTY);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="tool-name">Name</label>
        <input
          id="tool-name"
          className="input"
          maxLength={80}
          required
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
          placeholder="e.g. Cordless drill"
        />
      </div>
      <div>
        <label className="label" htmlFor="tool-category">Category</label>
        <select
          id="tool-category"
          className="input"
          value={value.category}
          onChange={(e) => setValue({ ...value, category: e.target.value as Category })}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tool-condition">Condition</label>
        <select
          id="tool-condition"
          className="input"
          value={value.condition}
          onChange={(e) => setValue({ ...value, condition: e.target.value as Condition })}
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="tool-description">Short description</label>
        <textarea
          id="tool-description"
          className="input"
          rows={2}
          maxLength={500}
          required
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

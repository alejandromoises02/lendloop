"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { CATEGORY_LABEL } from "@/lib/labels";
import { api } from "../../convex/_generated/api";

export default function Home() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <div className="space-y-10">
      <section className="space-y-4 py-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">LendLoop</h1>
        <p className="text-lg text-stone-600">Borrow what you need. Lend what you don&apos;t.</p>
        <Unauthenticated>
          <SignInButton mode="modal">
            <button className="btn-primary px-5 py-2 text-base">Sign in to lend or borrow</button>
          </SignInButton>
        </Unauthenticated>
        <Authenticated>
          <Link href="/tools" className="btn-primary px-5 py-2 text-base">Browse tools</Link>
        </Authenticated>
      </section>

      <section aria-labelledby="available-heading" className="space-y-3">
        <h2 id="available-heading" className="text-lg font-semibold">Available in the neighborhood</h2>
        {tools === undefined ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="card text-sm text-stone-500">No tools listed yet. Be the first to lend one.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((t) => (
              <li key={t._id} className="card">
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-stone-500">{CATEGORY_LABEL[t.category]}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

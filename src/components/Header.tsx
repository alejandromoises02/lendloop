"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "../../convex/_generated/api";

const LINKS = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

function Nav() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-2.5 py-1 ${
            pathname.startsWith(l.href) ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function Header() {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight text-brand-700">
          LendLoop
        </Link>
        <Authenticated>
          <Nav />
          <UserButton />
        </Authenticated>
        <Unauthenticated>
          <SignInButton mode="modal">
            <button className="btn-primary">Sign in to lend or borrow</button>
          </SignInButton>
        </Unauthenticated>
      </div>
    </header>
  );
}

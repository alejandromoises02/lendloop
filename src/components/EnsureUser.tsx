"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";

/** Creates the Convex user record on first sign-in, then renders the page. */
export function EnsureUser({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setReady(false);
      return;
    }
    let active = true;
    store({}).then(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [isAuthenticated, store]);

  if (!ready) return <p className="text-sm text-stone-500">Loading your account…</p>;
  return <>{children}</>;
}

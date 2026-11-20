"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/errors";

/** Runs a mutation and keeps a user-facing error message for the last failure. */
export function useSafeRun() {
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return { error, run };
}

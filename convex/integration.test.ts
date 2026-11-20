import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { todayIso } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "./lib/signature";

const SECRET = "test-shared-secret";

async function signedHeaders(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const timestamp = ts.toString();
  return {
    "Content-Type": "application/json",
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await sign(secret, timestamp, body),
  };
}

beforeEach(() => {
  vi.stubEnv("N8N_SHARED_SECRET", SECRET);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("HMAC signatures", () => {
  test("accepts a valid signature and rejects tampering, staleness and missing config", async () => {
    const now = 1_700_000_000;
    const ts = now.toString();
    const sig = await sign(SECRET, ts, '{"a":1}');

    expect(await verify(SECRET, ts, sig, '{"a":1}', now)).toEqual({ ok: true });
    expect(await verify(SECRET, ts, sig, '{"a":2}', now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verify("other-secret", ts, sig, '{"a":1}', now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verify(SECRET, ts, sig, '{"a":1}', now + 301)).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(await verify(SECRET, null, sig, '{"a":1}', now)).toEqual({ ok: false, reason: "missing_signature" });
    expect(await verify(undefined, ts, sig, '{"a":1}', now)).toEqual({ ok: false, reason: "server_not_configured" });
  });
});

async function seedOverdueLoan() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ name: "Alice", email: "alice@example.com", tokenIdentifier: "test|alice" });
  const bob = t.withIdentity({ name: "Bob Borrower", email: "bob@example.com", tokenIdentifier: "test|bob" });
  await alice.mutation(api.users.store, {});
  await bob.mutation(api.users.store, {});
  const toolId = await alice.mutation(api.tools.create, {
    name: "Ladder",
    category: "hand_tools",
    condition: "good",
    description: "3m",
  });
  const today = todayIso();
  const loanId = await bob.mutation(api.loans.request, { toolId, startDate: today, endDate: today });
  await alice.mutation(api.loans.decide, { loanId, decision: "approved" });
  // Two days later the loan is overdue.
  vi.setSystemTime(Date.now() + 2 * 86_400_000);
  return { t, bob, loanId };
}

describe("GET /n8n/overdue-loans", () => {
  test("requires a valid signature", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/n8n/overdue-loans", { method: "GET" });
    expect(res.status).toBe(401);
    const bad = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await signedHeaders("", "wrong") });
    expect(bad.status).toBe(401);
  });

  test("returns minimal fields for overdue loans and skips ones already reminded today", async () => {
    const { t, loanId } = await seedOverdueLoan();

    const res = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await signedHeaders("") });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toHaveLength(1);
    const [loan] = data.loans;
    expect(Object.keys(loan).sort()).toEqual(
      ["borrowerEmail", "borrowerFirstName", "daysOverdue", "endDate", "idempotencyKey", "loanId", "toolName"].sort(),
    );
    expect(loan).toMatchObject({ loanId, borrowerFirstName: "Bob", daysOverdue: 2, toolName: "Ladder" });

    const body = JSON.stringify({
      idempotencyKey: loan.idempotencyKey,
      kind: "overdue_reminder",
      loanId,
      status: "sent",
    });
    await t.fetch("/n8n/events", { method: "POST", headers: await signedHeaders(body), body });

    const again = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await signedHeaders("") });
    expect((await again.json()).loans).toHaveLength(0);
  });
});

describe("POST /n8n/events", () => {
  test("is idempotent: retries store one event and the app shows it on the loan", async () => {
    const { t, bob, loanId } = await seedOverdueLoan();
    const body = JSON.stringify({
      idempotencyKey: `overdue_reminder:${loanId}:2030-01-01`,
      kind: "overdue_reminder",
      loanId,
      status: "sent",
    });

    const first = await t.fetch("/n8n/events", { method: "POST", headers: await signedHeaders(body), body });
    expect(await first.json()).toEqual({ stored: true, duplicate: false });
    const retry = await t.fetch("/n8n/events", { method: "POST", headers: await signedHeaders(body), body });
    expect(await retry.json()).toEqual({ stored: true, duplicate: true });

    const count = await t.run(async (ctx) => (await ctx.db.query("automationEvents").collect()).length);
    expect(count).toBe(1);

    const [loan] = await bob.query(api.loans.myRequests, {});
    expect(loan.automation).toEqual([expect.objectContaining({ kind: "overdue_reminder", status: "sent" })]);
  });

  test("rejects unsigned, tampered and malformed requests", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ idempotencyKey: "workflow_error:x", kind: "workflow_error", status: "failed" });

    expect((await t.fetch("/n8n/events", { method: "POST", body })).status).toBe(401);

    const headers = await signedHeaders(body);
    const tampered = body.replace("failed", "sent");
    expect((await t.fetch("/n8n/events", { method: "POST", headers, body: tampered })).status).toBe(401);

    const extra = JSON.stringify({ idempotencyKey: "workflow_error:x", kind: "workflow_error", status: "sent", role: "admin" });
    const res = await t.fetch("/n8n/events", { method: "POST", headers: await signedHeaders(extra), body: extra });
    expect(res.status).toBe(400);

    const mismatched = JSON.stringify({ idempotencyKey: "overdue_reminder:x", kind: "workflow_error", status: "sent" });
    const res2 = await t.fetch("/n8n/events", {
      method: "POST",
      headers: await signedHeaders(mismatched),
      body: mismatched,
    });
    expect(res2.status).toBe(400);
  });

  test("records workflow errors without a loan", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({
      idempotencyKey: "workflow_error:exec-42",
      kind: "workflow_error",
      status: "failed",
      detail: "Overdue reminders: SMTP timeout",
    });
    const res = await t.fetch("/n8n/events", { method: "POST", headers: await signedHeaders(body), body });
    expect(res.status).toBe(200);
  });
});

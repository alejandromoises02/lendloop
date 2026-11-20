import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { addDays, todayIso } from "./lib/dates";

async function setup() {
  const t = convexTest(schema, modules);
  const as = (name: string, email: string) =>
    t.withIdentity({ name, email, subject: email, tokenIdentifier: `test|${email}` });
  const alice = as("Alice Lender", "alice@example.com");
  const bob = as("Bob Borrower", "bob@example.com");
  const carol = as("Carol Other", "carol@example.com");
  const admin = as("Ada Admin", "admin@example.com");
  for (const u of [alice, bob, carol, admin]) await u.mutation(api.users.store, {});

  const drillId = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V, two batteries",
  });
  return { t, alice, bob, carol, admin, drillId };
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("public listing", () => {
  test("exposes only name and category, and hides tools on loan", async () => {
    const { t, alice, bob, drillId } = await setup();
    const today = todayIso();

    const before = await t.query(api.tools.listPublic, {});
    expect(before).toEqual([{ _id: drillId, name: "Cordless drill", category: "power_tools" }]);

    const loanId = await bob.mutation(api.loans.request, { toolId: drillId, startDate: today, endDate: today });
    await alice.mutation(api.loans.decide, { loanId, decision: "approved" });

    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });

  test("signed-out callers cannot read the full catalog", async () => {
    const { t } = await setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow("UNAUTHENTICATED");
  });
});

describe("listings are owned", () => {
  test("only the owner can edit a listing", async () => {
    const { bob, admin, drillId } = await setup();
    const edit = { toolId: drillId, name: "Hacked", category: "other", condition: "worn", description: "x" } as const;
    await expect(bob.mutation(api.tools.update, edit)).rejects.toThrow("FORBIDDEN");
    await expect(admin.mutation(api.tools.update, edit)).rejects.toThrow("FORBIDDEN");
  });

  test("a user cannot delete someone else's listing, an admin can", async () => {
    const { t, bob, admin, drillId } = await setup();
    await expect(bob.mutation(api.tools.remove, { toolId: drillId })).rejects.toThrow("FORBIDDEN");
    await admin.mutation(api.tools.remove, { toolId: drillId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("loan lifecycle", () => {
  test("cannot borrow your own tool", async () => {
    const { alice, drillId } = await setup();
    const today = todayIso();
    await expect(
      alice.mutation(api.loans.request, { toolId: drillId, startDate: today, endDate: today }),
    ).rejects.toThrow("CANNOT_BORROW_OWN_TOOL");
  });

  test("rejects invalid date ranges", async () => {
    const { bob, drillId } = await setup();
    const today = todayIso();
    await expect(
      bob.mutation(api.loans.request, { toolId: drillId, startDate: addDays(today, 3), endDate: today }),
    ).rejects.toThrow("END_BEFORE_START");
    await expect(
      bob.mutation(api.loans.request, { toolId: drillId, startDate: addDays(today, -2), endDate: today }),
    ).rejects.toThrow("START_IN_PAST");
  });

  test("only the tool owner can approve, and only once", async () => {
    const { alice, bob, carol, drillId } = await setup();
    const today = todayIso();
    const loanId = await bob.mutation(api.loans.request, { toolId: drillId, startDate: today, endDate: today });

    await expect(carol.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toThrow("FORBIDDEN");
    await expect(bob.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toThrow("FORBIDDEN");

    await alice.mutation(api.loans.decide, { loanId, decision: "approved" });
    await expect(alice.mutation(api.loans.decide, { loanId, decision: "declined" })).rejects.toThrow(
      "INVALID_TRANSITION",
    );
  });

  test("overlapping requests cannot both be approved", async () => {
    const { alice, bob, carol, drillId } = await setup();
    const start = addDays(todayIso(), 1);
    const end = addDays(start, 2);
    const first = await bob.mutation(api.loans.request, { toolId: drillId, startDate: start, endDate: end });
    const second = await carol.mutation(api.loans.request, { toolId: drillId, startDate: end, endDate: end });

    await alice.mutation(api.loans.decide, { loanId: first, decision: "approved" });
    await expect(alice.mutation(api.loans.decide, { loanId: second, decision: "approved" })).rejects.toThrow(
      "DATES_ALREADY_BOOKED",
    );
  });

  test("only the two parties can mark a loan returned", async () => {
    const { alice, bob, carol, drillId } = await setup();
    const today = todayIso();
    const loanId = await bob.mutation(api.loans.request, { toolId: drillId, startDate: today, endDate: today });
    await alice.mutation(api.loans.decide, { loanId, decision: "approved" });

    await expect(carol.mutation(api.loans.markReturned, { loanId })).rejects.toThrow("FORBIDDEN");
    await alice.mutation(api.loans.markReturned, { loanId });
    const [loan] = await bob.query(api.loans.myRequests, {});
    expect(loan.status).toBe("returned");
  });

  test("each side sees only its own loans", async () => {
    const { alice, bob, carol, drillId } = await setup();
    const today = todayIso();
    await bob.mutation(api.loans.request, { toolId: drillId, startDate: today, endDate: today });

    expect(await bob.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await alice.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await carol.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await carol.query(api.loans.incoming, {})).toHaveLength(0);
  });
});

describe("admin powers", () => {
  test("only admins can view all loans and grant Trusted Lender", async () => {
    const { bob, admin, alice } = await setup();
    await expect(bob.query(api.loans.all, {})).rejects.toThrow("FORBIDDEN");

    const aliceUser = await alice.query(api.users.me, {});
    await expect(bob.mutation(api.users.setTrustedLender, { userId: aliceUser!._id, trusted: true })).rejects.toThrow(
      "FORBIDDEN",
    );
    await admin.mutation(api.users.setTrustedLender, { userId: aliceUser!._id, trusted: true });

    const [tool] = await bob.query(api.tools.list, {});
    expect(tool.ownerTrusted).toBe(true);
    expect(await admin.query(api.loans.all, {})).toEqual([]);
  });

  test("the admin role comes from ADMIN_EMAILS, not from the client", async () => {
    const { bob, admin } = await setup();
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
    expect((await bob.query(api.users.me, {}))?.role).toBe("user");
  });

  test("the signed-in owner's email is never exposed in the catalog", async () => {
    const { bob } = await setup();
    const [tool] = await bob.query(api.tools.list, {});
    expect(JSON.stringify(tool)).not.toContain("alice@example.com");
  });
});

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { daysBetween } from "./lib/dates";
import { overdueReminderKey } from "./lib/keys";
import { automationKind } from "./schema";

/**
 * Overdue = approved (still out) and past its end date. Loans already reminded
 * today are excluded, so a retried or duplicated scheduled run sends nothing twice.
 * Returns only what a reminder needs: first name, email, tool name, dates.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .collect();

    const result = [];
    for (const loan of loans) {
      const key = overdueReminderKey(loan._id, today);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (already?.status === "sent") continue;

      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!borrower?.email) continue;
      result.push({
        loanId: loan._id,
        idempotencyKey: key,
        borrowerFirstName: borrower.name.split(" ")[0],
        borrowerEmail: borrower.email,
        toolName: tool?.name ?? "a borrowed tool",
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back from n8n. The same idempotencyKey can arrive many times
 * (retries, re-runs); it is stored once. A later "sent" upgrades an earlier "failed".
 */
export const recordEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    kind: automationKind,
    loanId: v.optional(v.id("loans")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.loanId && !(await ctx.db.get(args.loanId))) {
      return { stored: false, reason: "unknown_loan" as const };
    }
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", detail: args.detail });
        return { stored: true, duplicate: false };
      }
      return { stored: true, duplicate: true };
    }
    await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      kind: args.kind,
      loanId: args.loanId,
      status: args.status,
      detail: args.detail?.slice(0, 300),
    });
    return { stored: true, duplicate: false };
  },
});

export const wasSent = internalQuery({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, { idempotencyKey }) => {
    const e = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    return e?.status === "sent";
  },
});

/** Admin view of failed automation runs, so nothing fails silently. */
export const recentFailures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db.query("automationEvents").order("desc").take(100);
    return events
      .filter((e) => e.status === "failed")
      .slice(0, 20)
      .map((e) => ({ _id: e._id, kind: e.kind, detail: e.detail, at: e._creationTime }));
  },
});

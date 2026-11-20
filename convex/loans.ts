import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import { rangesOverlap, todayIso, validateRequestRange } from "./lib/dates";

async function requireLoan(ctx: QueryCtx, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("NOT_FOUND");
  return loan;
}

/** Queue the outbound n8n notification in the same transaction as the state change. */
async function queueNotification(ctx: MutationCtx, loanId: Id<"loans">) {
  await ctx.scheduler.runAfter(0, internal.notifications.sendLoanEvent, { loanId, attempt: 1 });
}

async function hasApprovedOverlap(ctx: QueryCtx, loan: Doc<"loans">): Promise<boolean> {
  const others = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
    .collect();
  return others.some(
    (o) =>
      o._id !== loan._id &&
      o.status === "approved" &&
      rangesOverlap(o.startDate, o.endDate, loan.startDate, loan.endDate),
  );
}

/** Enrich loans for display. Each side only sees the other party's display name. */
async function present(ctx: QueryCtx, loans: Doc<"loans">[]) {
  const today = todayIso();
  return await Promise.all(
    loans.map(async (l) => {
      const [tool, owner, borrower, events] = await Promise.all([
        ctx.db.get(l.toolId),
        ctx.db.get(l.ownerId),
        ctx.db.get(l.borrowerId),
        ctx.db
          .query("automationEvents")
          .withIndex("by_loan", (q) => q.eq("loanId", l._id))
          .order("desc")
          .take(3),
      ]);
      return {
        _id: l._id,
        _creationTime: l._creationTime,
        toolName: tool?.name ?? "Removed listing",
        ownerName: owner?.name ?? "Unknown",
        borrowerName: borrower?.name ?? "Unknown",
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        overdue: l.status === "approved" && l.endDate < today,
        automation: events.map((e) => ({
          kind: e.kind,
          status: e.status,
          at: e._creationTime,
        })),
      };
    }),
  );
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("NOT_FOUND");
    if (tool.ownerId === me._id) throw new ConvexError("CANNOT_BORROW_OWN_TOOL");

    const error = validateRequestRange(args.startDate, args.endDate, todayIso());
    if (error) throw new ConvexError(error);

    const existing = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", args.toolId))
      .collect();
    const duplicate = existing.some(
      (l) =>
        l.borrowerId === me._id &&
        (l.status === "pending" || l.status === "approved") &&
        rangesOverlap(l.startDate, l.endDate, args.startDate, args.endDate),
    );
    if (duplicate) throw new ConvexError("DUPLICATE_REQUEST");

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
    });
    await queueNotification(ctx, loanId);
    return loanId;
  },
});

/** Only the tool's owner can approve or decline, and only while the request is pending. */
export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approved"), v.literal("declined")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await requireLoan(ctx, loanId);
    if (loan.ownerId !== me._id) throw new ConvexError("FORBIDDEN");
    if (loan.status !== "pending") throw new ConvexError("INVALID_TRANSITION");
    if (decision === "approved" && (await hasApprovedOverlap(ctx, loan))) {
      throw new ConvexError("DATES_ALREADY_BOOKED");
    }
    await ctx.db.patch(loanId, { status: decision });
    await queueNotification(ctx, loanId);
  },
});

/** The borrower can withdraw a request that has not been decided yet. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await requireLoan(ctx, loanId);
    if (loan.borrowerId !== me._id) throw new ConvexError("FORBIDDEN");
    if (loan.status !== "pending") throw new ConvexError("INVALID_TRANSITION");
    await ctx.db.patch(loanId, { status: "cancelled" });
    await queueNotification(ctx, loanId);
  },
});

/** The lender confirms the tool came back. Either party of the loan may record it. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await requireLoan(ctx, loanId);
    if (loan.ownerId !== me._id && loan.borrowerId !== me._id) throw new ConvexError("FORBIDDEN");
    if (loan.status !== "approved") throw new ConvexError("INVALID_TRANSITION");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await queueNotification(ctx, loanId);
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return await present(ctx, loans);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return await present(ctx, loans);
  },
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await present(ctx, loans);
  },
});

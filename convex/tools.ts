import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { isAdmin, requireUser } from "./lib/auth";
import { todayIso } from "./lib/dates";
import { category, condition } from "./schema";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

type Availability = "available" | "on_loan";

/** A tool is on loan while an approved, not-yet-returned loan has started. */
async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">, today: string): Promise<Availability> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  const active = loans.some((l) => l.status === "approved" && l.startDate <= today);
  return active ? "on_loan" : "available";
}

function cleanText(value: string, max: number, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConvexError(`${field.toUpperCase()}_REQUIRED`);
  if (trimmed.length > max) throw new ConvexError(`${field.toUpperCase()}_TOO_LONG`);
  return trimmed;
}

async function requireOwnTool(ctx: QueryCtx, toolId: Id<"tools">, userId: Id<"users">): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool) throw new ConvexError("NOT_FOUND");
  if (tool.ownerId !== userId) throw new ConvexError("FORBIDDEN");
  return tool;
}

/**
 * Public, unauthenticated. Data minimization: only name and category of tools
 * that are currently available. No owner, condition, description or loan data.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayIso();
    const tools = await ctx.db.query("tools").order("desc").take(100);
    const result: { _id: Id<"tools">; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const t of tools) {
      if ((await availabilityOf(ctx, t._id, today)) === "available") {
        result.push({ _id: t._id, name: t.name, category: t.category });
      }
    }
    return result;
  },
});

/** Signed-in users: every tool with its availability, optionally filtered by category. */
export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .order("desc")
          .collect()
      : await ctx.db.query("tools").order("desc").collect();

    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          availability: await availabilityOf(ctx, t._id, today),
          // Only a display name and the trust badge; never the owner's email.
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(
      tools.map(async (t) => ({ ...t, availability: await availabilityOf(ctx, t._id, today) })),
    );
  },
});

export const create = mutation({
  args: { name: v.string(), category, condition, description: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: cleanText(args.name, MAX_NAME, "name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, MAX_DESCRIPTION, "description"),
    });
  },
});

/** Only the owner can edit. Admins moderate by removing, not by rewriting someone else's listing. */
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireOwnTool(ctx, args.toolId, me._id);
    await ctx.db.patch(args.toolId, {
      name: cleanText(args.name, MAX_NAME, "name"),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, MAX_DESCRIPTION, "description"),
    });
  },
});

/** The owner can delete their own listing; an admin can remove any listing. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("NOT_FOUND");
    if (tool.ownerId !== me._id && !isAdmin(me)) throw new ConvexError("FORBIDDEN");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (loans.some((l) => l.status === "approved")) throw new ConvexError("TOOL_ON_LOAN");

    // Open requests can no longer be fulfilled once the listing is gone.
    for (const loan of loans) {
      if (loan.status === "pending") await ctx.db.patch(loan._id, { status: "cancelled" });
    }
    await ctx.db.delete(toolId);
  },
});

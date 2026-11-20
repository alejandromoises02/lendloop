import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, isAdminEmail, requireAdmin } from "./lib/auth";

/**
 * Creates or refreshes the user record for the signed-in Clerk identity.
 * The role is derived on the server from ADMIN_EMAILS; the client cannot choose it.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");

    const name = identity.name ?? identity.nickname ?? "Neighbor";
    const email = identity.email;
    const existing = await getCurrentUser(ctx);

    if (existing) {
      // Re-derived on every sign-in, so removing an email from ADMIN_EMAILS revokes admin.
      const role = isAdminEmail(email) ? "admin" : "user";
      if (existing.name !== name || existing.email !== email || existing.role !== role) {
        await ctx.db.patch(existing._id, { name, email, role });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isAdminEmail(email) ? "admin" : "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return { _id: user._id, name: user.name, role: user.role, trustedLender: user.trustedLender };
  },
});

/** Admin only: list lenders so an admin can grant the "Trusted Lender" badge. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("NOT_FOUND");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});


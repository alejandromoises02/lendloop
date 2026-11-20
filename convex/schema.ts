import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CATEGORIES, CONDITIONS } from "./lib/constants";

export const category = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const condition = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const loanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const automationKind = v.union(
  v.literal("request_notification"),
  v.literal("overdue_reminder"),
  v.literal("workflow_error"),
);

export default defineSchema({
  users: defineTable({
    // Stable identity from Clerk (issuer + subject). Never trust a user id sent by the client.
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // ISO dates (YYYY-MM-DD), inclusive range.
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatus,
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  automationEvents: defineTable({
    loanId: v.optional(v.id("loans")),
    kind: automationKind,
    status: v.union(v.literal("sent"), v.literal("failed")),
    // Unique per logical event, so retries from n8n never create duplicates.
    idempotencyKey: v.string(),
    detail: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_kind", ["kind"]),
});

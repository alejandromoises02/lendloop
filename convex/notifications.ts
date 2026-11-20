import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { requestNotificationKey } from "./lib/keys";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/signature";

const MAX_ATTEMPTS = 4;

/**
 * Builds the smallest payload n8n needs to notify one person.
 * Who is notified depends on the transition: the lender hears about new or
 * withdrawn requests, the borrower hears about decisions and returns.
 */
export const payloadFor = internalQuery({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const tool = await ctx.db.get(loan.toolId);
    const notifyOwner = loan.status === "pending" || loan.status === "cancelled";
    const recipient = await ctx.db.get(notifyOwner ? loan.ownerId : loan.borrowerId);
    if (!recipient?.email) return null;

    return {
      eventId: requestNotificationKey(loan._id, loan.status),
      type: "loan.status_changed" as const,
      loanId: loan._id,
      status: loan.status,
      toolName: tool?.name ?? "a tool",
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipient: { firstName: recipient.name.split(" ")[0], email: recipient.email },
    };
  },
});

/**
 * Sends a signed webhook to n8n. Retries with exponential backoff (1s, 2s, 4s)
 * through the scheduler; after the last attempt the failure is recorded so it
 * shows up in the admin view instead of disappearing.
 */
export const sendLoanEvent = internalAction({
  args: { loanId: v.id("loans"), attempt: v.number() },
  handler: async (ctx, { loanId, attempt }) => {
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_SHARED_SECRET;
    if (!url || !secret) {
      console.warn("n8n webhook not configured; skipping notification");
      return;
    }

    const payload = await ctx.runQuery(internal.notifications.payloadFor, { loanId });
    if (!payload) return;
    if (await ctx.runQuery(internal.automation.wasSent, { idempotencyKey: payload.eventId })) return;

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let failure: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: await sign(secret, timestamp, body),
          "Idempotency-Key": payload.eventId,
        },
        body,
      });
      if (res.ok) return;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : "network error";
    }

    if (attempt < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(1000 * 2 ** (attempt - 1), internal.notifications.sendLoanEvent, {
        loanId,
        attempt: attempt + 1,
      });
      return;
    }
    await ctx.runMutation(internal.automation.recordEvent, {
      idempotencyKey: payload.eventId,
      kind: "request_notification",
      loanId,
      status: "failed",
      detail: `Webhook delivery failed after ${MAX_ATTEMPTS} attempts: ${failure}`,
    });
  },
});

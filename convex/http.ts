import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { todayIso } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/signature";

const http = httpRouter();

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Rejects any request not signed with the shared secret. Generic error, no detail leaked. */
async function authorize(request: Request, rawBody: string): Promise<Response | null> {
  const result = await verify(
    process.env.N8N_SHARED_SECRET,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
    rawBody,
  );
  if (result.ok) return null;
  console.warn(`Rejected n8n request: ${result.reason}`);
  return json(401, { error: "unauthorized" });
}

/** Called by the daily n8n workflow. Returns overdue loans not yet reminded today. */
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await authorize(request, "");
    if (denied) return denied;
    const today = todayIso();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { date: today, loans });
  }),
});

const eventBody = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    kind: z.enum(["request_notification", "overdue_reminder", "workflow_error"]),
    loanId: z.string().min(1).max(64).optional(),
    status: z.enum(["sent", "failed"]),
    detail: z.string().max(300).optional(),
  })
  .strict()
  .refine((b) => b.idempotencyKey.startsWith(`${b.kind}:`), {
    message: "idempotencyKey must start with the event kind",
  });

/** Idempotent write-back of automation results (reminders sent, notifications delivered, errors). */
http.route({
  path: "/n8n/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const denied = await authorize(request, rawBody);
    if (denied) return denied;

    let parsed: z.infer<typeof eventBody>;
    try {
      parsed = eventBody.parse(JSON.parse(rawBody));
    } catch {
      return json(400, { error: "invalid_body" });
    }

    try {
      const result = await ctx.runMutation(internal.automation.recordEvent, {
        ...parsed,
        loanId: parsed.loanId as Id<"loans"> | undefined,
      });
      return json(result.stored ? 200 : 404, result);
    } catch {
      // A malformed loan id fails argument validation; report it without internals.
      return json(400, { error: "invalid_loan_id" });
    }
  }),
});

export default http;

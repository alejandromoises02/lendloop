"""Generates the n8n workflow exports in n8n/workflows/.

Keeping the workflows as code makes the signing logic reviewable in one place
and guarantees no secret or credential ever lands in the exported JSON.
Run: python3 scripts/build-workflows.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "n8n" / "workflows"
ERROR_WORKFLOW_ID = "LendLoopErrors01"

SIGN_HELPER = r"""
const crypto = require('crypto');
const secret = $env.LENDLOOP_SHARED_SECRET;
if (!secret) throw new Error('LENDLOOP_SHARED_SECRET is not set');
function signed(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return { timestamp, signature };
}
""".strip()

RETRY = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 3000}


def code(node_id, name, js, pos, mode="runOnceForAllItems"):
    return {
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": pos,
        "parameters": {"mode": mode, "jsCode": js.strip()},
    }


def post_event(node_id, pos):
    """Signed, idempotent write-back to Convex. Retries on failure."""
    return {
        "id": node_id,
        "name": "Write back to Convex",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": pos,
        **RETRY,
        "parameters": {
            "method": "POST",
            "url": "={{ $env.CONVEX_SITE_URL }}/n8n/events",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "X-LendLoop-Timestamp", "value": "={{ $json.timestamp }}"},
                    {"name": "X-LendLoop-Signature", "value": "={{ $json.signature }}"},
                ]
            },
            "sendBody": True,
            "contentType": "raw",
            "rawContentType": "application/json",
            "body": "={{ $json.body }}",
            "options": {"timeout": 10000},
        },
    }


def connect(*pairs):
    conns = {}
    for src, dst, *idx in pairs:
        out = idx[0] if idx else 0
        main = conns.setdefault(src, {"main": []})["main"]
        while len(main) <= out:
            main.append([])
        main[out].append({"node": dst, "type": "main", "index": 0})
    return conns


def workflow(wf_id, name, nodes, connections, error_workflow=True):
    settings = {"executionOrder": "v1", "saveDataErrorExecution": "all"}
    if error_workflow:
        settings["errorWorkflow"] = ERROR_WORKFLOW_ID
    return {
        "id": wf_id,
        "name": name,
        "active": False,
        "nodes": nodes,
        "connections": connections,
        "settings": settings,
        "pinData": {},
        "tags": [],
    }


# 1. Request notification -------------------------------------------------
verify_js = SIGN_HELPER + r"""

// Verify the HMAC over the exact raw bytes Convex signed, not a re-serialized object.
const item = $input.first();
const headers = item.json.headers || {};
const timestamp = headers['x-lendloop-timestamp'];
const signature = String(headers['x-lendloop-signature'] || '');
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');

const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
const valid =
  Number.isFinite(skew) && skew <= 300 &&
  signature.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

return [{ json: { valid, payload: valid ? JSON.parse(raw) : null } }];
"""

notify_js = r"""
// Mock notification: logs only the fields needed to notify one person.
// Swap this node for Email / Slack / Discord in production.
const p = $input.first().json.payload;
const messages = {
  pending: `New request to borrow your ${p.toolName} (${p.startDate} to ${p.endDate}).`,
  approved: `Your request for ${p.toolName} was approved (${p.startDate} to ${p.endDate}).`,
  declined: `Your request for ${p.toolName} was declined.`,
  cancelled: `A request for your ${p.toolName} was withdrawn.`,
  returned: `The loan of ${p.toolName} was marked as returned.`,
};
const message = `Hi ${p.recipient.firstName}, ${messages[p.status] ?? 'your loan was updated.'}`;
console.log(`[LendLoop] to=${p.recipient.email} ${message}`);
return [{ json: { loanId: p.loanId, eventId: p.eventId } }];
"""

sign_notification_js = SIGN_HELPER + r"""

const { loanId, eventId } = $input.first().json;
const body = JSON.stringify({ idempotencyKey: eventId, kind: 'request_notification', loanId, status: 'sent' });
return [{ json: { body, ...signed(body) } }];
"""

request_nodes = [
    {
        "id": "rn-webhook",
        "name": "Loan event webhook",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [0, 300],
        "webhookId": "lendloop-loan-events",
        "parameters": {
            "httpMethod": "POST",
            "path": "lendloop/loan-events",
            "responseMode": "responseNode",
            "options": {"rawBody": True},
        },
    },
    code("rn-verify", "Verify signature", verify_js, [220, 300]),
    {
        "id": "rn-if",
        "name": "Signature valid?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": [440, 300],
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "typeValidation": "strict"},
                "conditions": [
                    {
                        "id": "valid-check",
                        "leftValue": "={{ $json.valid }}",
                        "rightValue": True,
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    },
    code("rn-notify", "Notify recipient (mock)", notify_js, [660, 200]),
    code("rn-sign", "Sign write-back", sign_notification_js, [880, 200]),
    post_event("rn-post", [1100, 200]),
    {
        "id": "rn-ok",
        "name": "Respond 200",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [1320, 200],
        "parameters": {"respondWith": "json", "responseBody": '={"ok": true}', "options": {"responseCode": 200}},
    },
    {
        "id": "rn-401",
        "name": "Respond 401",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [660, 420],
        "parameters": {"respondWith": "json", "responseBody": '={"error": "unauthorized"}', "options": {"responseCode": 401}},
    },
]
request_conns = connect(
    ("Loan event webhook", "Verify signature"),
    ("Verify signature", "Signature valid?"),
    ("Signature valid?", "Notify recipient (mock)", 0),
    ("Signature valid?", "Respond 401", 1),
    ("Notify recipient (mock)", "Sign write-back"),
    ("Sign write-back", "Write back to Convex"),
    ("Write back to Convex", "Respond 200"),
)

# 2. Overdue reminders -----------------------------------------------------
sign_get_js = SIGN_HELPER + r"""

// GET has no body, so the signed message is `${timestamp}.`
return [{ json: signed('') }];
"""

fetch_node = {
    "id": "od-fetch",
    "name": "Fetch overdue loans",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [440, 300],
    **RETRY,
    "parameters": {
        "method": "GET",
        "url": "={{ $env.CONVEX_SITE_URL }}/n8n/overdue-loans",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {"name": "X-LendLoop-Timestamp", "value": "={{ $json.timestamp }}"},
                {"name": "X-LendLoop-Signature", "value": "={{ $json.signature }}"},
            ]
        },
        "options": {"timeout": 10000},
    },
}

split_js = r"""
// One item per overdue loan. Convex already excludes loans reminded today,
// so re-running this workflow does not remind anyone twice.
const { loans = [] } = $input.first().json;
return loans.map((loan) => ({ json: loan }));
"""

remind_js = r"""
// Mock reminder: log only. Replace with an Email node in production.
const loan = $json;
const days = loan.daysOverdue === 1 ? '1 day' : `${loan.daysOverdue} days`;
console.log(`[LendLoop] to=${loan.borrowerEmail} Hi ${loan.borrowerFirstName}, ${loan.toolName} was due on ${loan.endDate} (${days} ago). Please return it.`);
return { json: { loanId: loan.loanId, idempotencyKey: loan.idempotencyKey } };
"""

sign_reminder_js = SIGN_HELPER + r"""

return $input.all().map(({ json }) => {
  const body = JSON.stringify({
    idempotencyKey: json.idempotencyKey,
    kind: 'overdue_reminder',
    loanId: json.loanId,
    status: 'sent',
  });
  return { json: { body, ...signed(body) } };
});
"""

overdue_nodes = [
    {
        "id": "od-schedule",
        "name": "Every day at 09:00",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.2,
        "position": [0, 300],
        "parameters": {"rule": {"interval": [{"field": "days", "triggerAtHour": 9}]}},
    },
    code("od-sign-get", "Sign request", sign_get_js, [220, 300]),
    fetch_node,
    code("od-split", "One item per loan", split_js, [660, 300]),
    code("od-remind", "Send reminder (mock)", remind_js, [880, 300], mode="runOnceForEachItem"),
    code("od-sign", "Sign write-back", sign_reminder_js, [1100, 300]),
    post_event("od-post", [1320, 300]),
]
overdue_conns = connect(
    ("Every day at 09:00", "Sign request"),
    ("Sign request", "Fetch overdue loans"),
    ("Fetch overdue loans", "One item per loan"),
    ("One item per loan", "Send reminder (mock)"),
    ("Send reminder (mock)", "Sign write-back"),
    ("Sign write-back", "Write back to Convex"),
)

# 3. Error handler ---------------------------------------------------------
error_js = SIGN_HELPER + r"""

// Runs when any LendLoop workflow fails after its retries, so failures are never silent.
const { execution = {}, workflow = {} } = $input.first().json;
const detail = `${workflow.name ?? 'Workflow'}: ${execution.error?.message ?? 'unknown error'}`.slice(0, 300);
console.error(`[LendLoop] automation failure: ${detail}`);
const body = JSON.stringify({
  idempotencyKey: `workflow_error:${execution.id ?? Date.now()}`,
  kind: 'workflow_error',
  status: 'failed',
  detail,
});
return [{ json: { body, ...signed(body) } }];
"""

error_nodes = [
    {
        "id": "er-trigger",
        "name": "On workflow error",
        "type": "n8n-nodes-base.errorTrigger",
        "typeVersion": 1,
        "position": [0, 300],
        "parameters": {},
    },
    code("er-build", "Build error event", error_js, [220, 300]),
    post_event("er-post", [440, 300]),
]
error_conns = connect(("On workflow error", "Build error event"), ("Build error event", "Write back to Convex"))

files = {
    "lendloop-request-notification.json": workflow(
        "LendLoopNotify01", "LendLoop – Request notification", request_nodes, request_conns
    ),
    "lendloop-overdue-reminders.json": workflow(
        "LendLoopOverdue1", "LendLoop – Overdue reminders", overdue_nodes, overdue_conns
    ),
    "lendloop-error-handler.json": workflow(
        ERROR_WORKFLOW_ID, "LendLoop – Error handler", error_nodes, error_conns, error_workflow=False
    ),
}

OUT.mkdir(parents=True, exist_ok=True)
for filename, data in files.items():
    (OUT / filename).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote n8n/workflows/{filename}")

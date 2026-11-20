// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { sign, verify } from "../convex/lib/signature";

const dir = join(__dirname, "workflows");
const workflows = readdirSync(dir).map((f) => ({ file: f, json: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
const SECRET = "shared-secret-for-tests";
const nodeRequire = createRequire(import.meta.url);

type N8nNode = { name: string; type: string; parameters: { jsCode?: string } };

function codeOf(workflowFile: string, nodeName: string): string {
  const wf = workflows.find((w) => w.file === workflowFile)!;
  const node = (wf.json.nodes as N8nNode[]).find((n) => n.name === nodeName);
  if (!node?.parameters.jsCode) throw new Error(`No code node "${nodeName}" in ${workflowFile}`);
  return node.parameters.jsCode;
}

/** Runs an n8n Code node body with the globals n8n provides. */
async function runCodeNode(js: string, globals: Record<string, unknown>, self: unknown = {}) {
  const names = Object.keys(globals);
  const fn = new Function(...names, `return (async function () { ${js} }).call(this);`);
  return await fn.call(self, ...names.map((n) => globals[n]));
}

describe("exported n8n workflows", () => {
  test("contain no secret values or credentials", () => {
    for (const { file, json } of workflows) {
      const text = JSON.stringify(json);
      expect(text, file).not.toContain(SECRET);
      expect(json.nodes.every((n: { credentials?: unknown }) => !n.credentials), file).toBe(true);
      expect(text, file).not.toMatch(/sk_(test|live)_|pk_(test|live)_/);
    }
  });

  test("route failures to the error workflow", () => {
    const errorId = workflows.find((w) => w.file === "lendloop-error-handler.json")!.json.id;
    for (const { file, json } of workflows) {
      if (file === "lendloop-error-handler.json") continue;
      expect(json.settings.errorWorkflow, file).toBe(errorId);
      const http = json.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.httpRequest");
      for (const node of http) expect(node.retryOnFail, `${file}: ${node.name}`).toBe(true);
    }
  });

  test("write-backs signed by n8n pass Convex verification", async () => {
    const js = codeOf("lendloop-overdue-reminders.json", "Sign write-back");
    const items = [{ json: { loanId: "abc123", idempotencyKey: "overdue_reminder:abc123:2030-01-01" } }];
    const [out] = await runCodeNode(js, {
      require: nodeRequire,
      $env: { LENDLOOP_SHARED_SECRET: SECRET },
      $input: { all: () => items, first: () => items[0] },
    });

    expect(JSON.parse(out.json.body)).toEqual({
      idempotencyKey: "overdue_reminder:abc123:2030-01-01",
      kind: "overdue_reminder",
      loanId: "abc123",
      status: "sent",
    });
    expect(await verify(SECRET, out.json.timestamp, out.json.signature, out.json.body)).toEqual({ ok: true });
  });

  test("the GET request for overdue loans is signed over an empty body", async () => {
    const [out] = await runCodeNode(codeOf("lendloop-overdue-reminders.json", "Sign request"), {
      require: nodeRequire,
      $env: { LENDLOOP_SHARED_SECRET: SECRET },
    });
    expect(await verify(SECRET, out.json.timestamp, out.json.signature, "")).toEqual({ ok: true });
  });

  test("n8n accepts webhooks signed by Convex and rejects tampered ones", async () => {
    const js = codeOf("lendloop-request-notification.json", "Verify signature");
    const raw = JSON.stringify({ eventId: "request_notification:l1:pending", status: "pending" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(SECRET, timestamp, raw);

    const run = (body: string, sig: string) => {
      const item = { json: { headers: { "x-lendloop-timestamp": timestamp, "x-lendloop-signature": sig } } };
      return runCodeNode(
        js,
        { require: nodeRequire, $env: { LENDLOOP_SHARED_SECRET: SECRET }, $input: { first: () => item } },
        { helpers: { getBinaryDataBuffer: async () => Buffer.from(body, "utf8") } },
      );
    };

    const [ok] = await run(raw, signature);
    expect(ok.json).toEqual({ valid: true, payload: JSON.parse(raw) });

    const [tampered] = await run(raw.replace("pending", "approved"), signature);
    expect(tampered.json.valid).toBe(false);

    const [badSig] = await run(raw, "0".repeat(64));
    expect(badSig.json.valid).toBe(false);
  });
});

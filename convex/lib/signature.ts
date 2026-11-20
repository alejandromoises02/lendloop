/**
 * HMAC-SHA256 request signing shared by both directions of the n8n integration.
 *
 * Signed message: `${timestamp}.${rawBody}` (rawBody is "" for GET requests).
 * Headers:        X-LendLoop-Timestamp: <unix seconds>
 *                 X-LendLoop-Signature: <hex digest>
 *
 * Including the timestamp in the signed message and rejecting old timestamps
 * limits replay of captured requests.
 */
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return toHex(mac);
}

/** Constant-time comparison so response timing does not leak how many characters matched. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "server_not_configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing_signature" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = await sign(secret, timestamp, rawBody);
  return safeEqual(expected, signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

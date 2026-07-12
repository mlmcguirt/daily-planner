// Shared helpers for the /api functions.
// Lives outside functions/ so it isn't routed as an endpoint.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// SHA-256 the passphrase to get a stable, non-reversible space id
export async function spaceFromKey(key) {
  const enc = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Every endpoint takes the passphrase the same way; returns the space id or null.
export async function spaceFromRequest(request) {
  const key = request.headers.get("X-Planner-Key");
  if (!key) return null;
  return spaceFromKey(key);
}

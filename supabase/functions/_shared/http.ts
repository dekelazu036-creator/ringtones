// Small HTTP helpers shared by the library functions. Runtime-neutral (Web APIs only).

export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const h: Record<string, string> = { 'Vary': 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info, x-library-meta';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

export function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

// constant-time comparison for shared secrets
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// read at most `max` bytes; returns null if the body is larger (stops reading early and leaves the
// rest unread but unlocked, so the handler's discardBody can still drain it)
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null | 'missing'> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return null;
  if (!req.body) return 'missing';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { reader.releaseLock(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// read and drop a request body nobody read (at most `max` bytes, then cancel).
// On the hosted runtime a response sent while the client is still sending the body never arrives:
// staging T9b (11 MiB, 413 decided from content-length) hung until the 150 s wall clock → 503.
export async function discardBody(req: Request, max: number): Promise<void> {
  if (!req.body || req.body.locked) return;            // locked = a reader is still busy with it (fully read)
  const reader = req.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > max) { await reader.cancel(); return; }
    }
  } catch { /* client went away */ }
}

export function decodeMeta(header: string | null): Record<string, unknown> | null {
  if (!header || header.length > 4096) return null;
  try {
    const b64 = header.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

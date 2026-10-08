// SnipRing Phase 1B — logic of the three library Edge Functions.
// Runtime-neutral: everything that talks to Supabase is injected (see supabase.ts), so the same code
// runs in Deno (production) and in the local Node test harness.
//
// Rules this file keeps:
//  * the user id comes ONLY from a verified session token (Auth getUser), never from the request body;
//  * size, SHA-256 and duration are measured here on the received bytes;
//  * every state change goes through public.svc_library (SQL, one short transaction each);
//  * no lock is held while talking to Storage (Storage calls happen between SQL calls).

import { checkMp3, sha256Hex } from './mp3.ts';
import { bearer, corsHeaders, decodeMeta, discardBody, json, readCapped, safeEqual, UUID_RE } from './http.ts';

export type User = { id: string; isAnonymous: boolean };
export type Deps = {
  getUser(token: string): Promise<User | null>;
  rpc(op: string, args: Record<string, unknown>): Promise<any>;            // throws on transport/SQL error
  upload(path: string, bytes: Uint8Array): Promise<'ok' | 'exists' | { error: string }>;
  signedUrl(path: string, seconds: number, downloadName: string): Promise<string | null>;
  remove(paths: string[]): Promise<{ removed: string[] } | { error: string }>;
  log?(event: Record<string, unknown>): void;
};
export type Config = {
  allowedOrigins: string[];
  maxFileBytes: number;          // must equal limits.max_file and the bucket limit (10 MiB)
  signedUrlSeconds: number;      // fixed on the server (300)
  janitorSecret?: string;
  janitorBudgetMs?: number;      // stop starting new work after this (Free plan wall clock is 150 s)
  holder?: string;
};

export const SOUND_TYPES = ['ring', 'text', 'alarm', 'sfx', 'intro', 'outro', 'custom'];
export const ORIGINS = ['file', 'video', 'record', 'generated', 'discover', 'demo', 'mine', 'studio'];

const ERR_STATUS: Record<string, number> = {
  bad_request: 400, bad_hash: 400, unauthorized: 401, not_enabled: 403,
  quota_items: 403, quota_bytes: 403, quota_physical: 403,
  not_found: 404, job_closed: 409, expired: 409, client_key_conflict: 409,
  file_too_large: 413, not_mp3: 415, bad_duration: 422, mismatch: 422,
  rate_limited: 429, too_many_uploads: 429,
  object_missing: 502, storage_error: 502, server_error: 500,
  reservations_closed: 503, stopped: 503, service_full: 503,
};
const RETRYABLE = new Set(['object_missing', 'storage_error', 'server_error']);

function fail(code: string, cors: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, retryable: RETRYABLE.has(code), ...extra }, ERR_STATUS[code] ?? 400, cors);
}

async function authenticate(req: Request, deps: Deps): Promise<User | null> {
  const token = bearer(req);
  if (!token || token.split('.').length !== 3) return null;    // API keys are not user sessions
  try {
    const u = await deps.getUser(token);                         // verified by Supabase Auth (signature, expiry, user exists)
    if (!u || !UUID_RE.test(u.id) || u.isAnonymous) return null;
    return u;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ library-upload
export async function handleUpload(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  const res = await uploadResponse(req, deps, cfg);
  // every early refusal (401, 400, 413 by content-length) leaves the file unread: drain it first
  await discardBody(req, 2 * cfg.maxFileBytes);
  return res;
}

async function uploadResponse(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  const cors = corsHeaders(req, cfg.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('bad_request', cors);

  const user = await authenticate(req, deps);
  if (!user) return fail('unauthorized', cors);

  const meta = decodeMeta(req.headers.get('x-library-meta'));
  const clientKey = typeof meta?.client_key === 'string' ? meta.client_key.toLowerCase() : '';
  const type = meta?.type, origin = meta?.origin, name = meta?.name;
  if (!meta || !UUID_RE.test(clientKey) || !SOUND_TYPES.includes(type as string) || !ORIGINS.includes(origin as string)
      || (name !== undefined && (typeof name !== 'string' || name.length > 200))
      || (meta.allow_duplicate !== undefined && typeof meta.allow_duplicate !== 'boolean')) {
    return fail('bad_request', cors);
  }

  const body = await readCapped(req, cfg.maxFileBytes);
  if (body === null) return fail('file_too_large', cors);
  if (body === 'missing' || body.byteLength === 0) return fail('bad_request', cors);

  const mp3 = checkMp3(body);
  if (!mp3.ok) return fail('not_mp3', cors, { reason: mp3.reason });
  if (mp3.durationMs < 100 || mp3.durationMs > 300000) return fail('bad_duration', cors);
  const sha256 = await sha256Hex(body);

  try {
    const begin = await deps.rpc('begin', {
      // control characters removed here too: Postgres jsonb rejects \u0000 (SQL cleans the rest)
      user_id: user.id, client_key: clientKey, name: String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ''), type, origin,
      duration_ms: mp3.durationMs, size: body.byteLength, sha256, allow_duplicate: meta.allow_duplicate === true,
    });
    if (begin?.error) return fail(String(begin.error), cors, begin.state ? { state: begin.state } : {});
    if (begin?.status === 'done') return json({ status: 'ready', id: begin.id }, 200, cors);
    if (begin?.status === 'duplicate') {
      return json({ status: 'duplicate', id: begin.id, state: begin.state, name: begin.name }, 200, cors);
    }
    if (begin?.status !== 'upload' || !UUID_RE.test(begin.id) || begin.path !== `${user.id}/${begin.id}.mp3`) {
      return fail('server_error', cors);
    }
    // a retried job must carry the very same bytes it reserved
    if (begin.sha256 !== sha256 || Number(begin.size) !== body.byteLength) return fail('client_key_conflict', cors);

    const up = await deps.upload(begin.path, body);                       // no SQL lock is held here
    if (typeof up === 'object') {
      deps.log?.({ fn: 'library-upload', event: 'storage_error', item: begin.id, error: up.error });
      return fail('storage_error', cors, { id: begin.id });               // reservation stays until it expires
    }

    const fin = await deps.rpc('finish', { user_id: user.id, id: begin.id });
    if (fin?.error) return fail(String(fin.error), cors, { id: begin.id, ...(fin.state ? { state: fin.state } : {}) });
    return json({ status: 'ready', id: begin.id }, 200, cors);
  } catch (e) {
    deps.log?.({ fn: 'library-upload', event: 'exception', error: String(e) });
    return fail('server_error', cors);
  }
}

// ------------------------------------------------------------------ library-download
export async function handleDownload(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  const res = await downloadResponse(req, deps, cfg);
  await discardBody(req, 64 * 1024);                   // a real body is ~50 bytes of JSON
  return res;
}

async function downloadResponse(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  const cors = corsHeaders(req, cfg.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('bad_request', cors);
  const user = await authenticate(req, deps);
  if (!user) return fail('unauthorized', cors);

  let id = '';
  try {
    const b = await readCapped(req, 1024);
    if (b && b !== 'missing') id = String(JSON.parse(new TextDecoder().decode(b))?.id ?? '').toLowerCase();
  } catch { /* fall through */ }
  if (!UUID_RE.test(id)) return fail('bad_request', cors);

  try {
    const item = await deps.rpc('ready_item', { user_id: user.id, id });   // owner AND state = ready, checked in SQL
    if (!item?.path) return fail('not_found', cors);
    if (item.path !== `${user.id}/${id}.mp3`) return fail('server_error', cors);
    const url = await deps.signedUrl(item.path, cfg.signedUrlSeconds, `${item.name}.mp3`);
    if (!url) return fail('storage_error', cors);
    return json({ url, expires_in: cfg.signedUrlSeconds }, 200, cors);
  } catch (e) {
    deps.log?.({ fn: 'library-download', event: 'exception', error: String(e) });
    return fail('server_error', cors);
  }
}

// ------------------------------------------------------------------ library-janitor
export type JanitorReport = {
  expired: number; purged: number; purge_failed: number; orphans: number; audited: number; drift: number;
  tombstones: number; stopped_early: boolean;
};

export async function handleJanitor(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  const res = await janitorResponse(req, deps, cfg);
  await discardBody(req, 64 * 1024);                   // verify_jwt is off here: anyone can POST a body
  return res;
}

async function janitorResponse(req: Request, deps: Deps, cfg: Config): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'bad_request' }, 400);
  const secret = cfg.janitorSecret ?? '';
  const token = bearer(req) ?? '';
  if (secret.length < 32) return json({ error: 'janitor_not_configured' }, 500);   // refuse to run with a weak/missing secret
  if (!safeEqual(token, secret)) return json({ error: 'unauthorized' }, 401);
  try {
    const report = await runJanitor(deps, cfg);
    return json(report ?? { skipped: 'another run holds the lease' }, 200);
  } catch (e) {
    deps.log?.({ fn: 'library-janitor', event: 'exception', error: String(e) });
    return json({ error: 'server_error' }, 500);
  }
}

export async function runJanitor(deps: Deps, cfg: Config): Promise<JanitorReport | null> {
  const holder = cfg.holder ?? crypto.randomUUID();
  const deadline = Date.now() + (cfg.janitorBudgetMs ?? 100_000);
  if ((await deps.rpc('janitor_acquire', { holder, secs: 180 })) !== true) return null;
  const r: JanitorReport = { expired: 0, purged: 0, purge_failed: 0, orphans: 0, audited: 0, drift: 0, tombstones: 0, stopped_early: false };
  const time = () => { if (Date.now() > deadline) { r.stopped_early = true; return false; } return true; };
  try {
    // 1. expired reservations → abandoned (quota moves to "releasing")
    for (const x of (await deps.rpc('expired', { limit: 100 })) as { user_id: string; id: string }[]) {
      if (!time()) break;
      if ((await deps.rpc('abandon', { user_id: x.user_id, id: x.id, reason: 'expired' })) === 'abandoned') r.expired++;
    }
    // 2. deletions and abandoned uploads whose grace period is over → remove object via Storage API → confirm in SQL
    while (time()) {
      const due = (await deps.rpc('due_purges', { limit: 50 })) as { id: string; path: string }[];
      if (!due.length) break;
      const res = await deps.remove(due.map((d) => d.path));
      for (const d of due) {
        const out = 'error' in res ? 'remove_failed' : await deps.rpc('purged', { id: d.id });
        if (out === 'purged') r.purged++;
        else {
          r.purge_failed++;
          await deps.rpc('purge_failed', { id: d.id, error: 'error' in res ? res.error : String(out) });
        }
      }
      if (due.length < 50) break;
    }
    // 3. orphaned objects (no live row, older than 1 h) → remove
    if (time()) {
      const names = (await deps.rpc('orphans', { limit: 100 })) as string[];
      if (names.length) {
        const res = await deps.remove(names);
        if (!('error' in res)) {
          await deps.rpc('orphans_removed', { names: res.removed });
          r.orphans = res.removed.length;
        }
      }
    }
    // 4. recount users not audited in the last hour (each user = its own short transaction)
    if (time()) {
      for (const uid of (await deps.rpc('audit_due', { limit: 50 })) as string[]) {
        if (!time()) break;
        r.audited++;
        if ((await deps.rpc('audit_user', { user_id: uid })) === true) r.drift++;
      }
    }
    // 5. tombstones older than 30 days
    if (time()) r.tombstones = Number(await deps.rpc('drop_tombstones', {}));
    await deps.rpc('run_log', { detail: r });
    return r;
  } finally {
    await deps.rpc('janitor_release', { holder }).catch(() => {});
  }
}

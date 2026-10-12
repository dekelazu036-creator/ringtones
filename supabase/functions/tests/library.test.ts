// Integration tests: the real function logic (library.ts) against the real SQL (library_1b.sql)
// on a LOCAL scratch Postgres. Supabase Auth and Storage are replaced by small fakes that behave
// like them (Storage writes storage.objects with size/mimetype metadata, refuses overwrite).
// LOCAL ONLY. Staging tests against real Auth/Storage are listed in supabase/tests/TEST_MATRIX.md.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { handleAccountDelete, handleDownload, handleHealth, handleJanitor, handleUpload, runJanitor, type Config, type Deps } from '../_shared/library.ts';
import { ffmpeg, sine, siteMp3 } from './fixtures.ts';

const DB = 'snipring_fn_test';
const SQL_DIR = fileURLToPath(new URL('../../', import.meta.url));
const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b2';
const C = '00000000-0000-0000-0000-0000000000c3';      // not in the beta allow-list
const ANON = '00000000-0000-0000-0000-0000000000d4';   // anonymous sign-in
const E = '00000000-0000-0000-0000-0000000000e5';      // deletes their account
const F = '00000000-0000-0000-0000-0000000000f6';      // deletion where Auth fails once
const TOKENS: Record<string, { id: string; isAnonymous: boolean }> = {
  'hdr.userA.sig': { id: A, isAnonymous: false },
  'hdr.userB.sig': { id: B, isAnonymous: false },
  'hdr.userC.sig': { id: C, isAnonymous: false },
  'hdr.anon.sig': { id: ANON, isAnonymous: true },
  'hdr.userE.sig': { id: E, isAnonymous: false },
  'hdr.userF.sig': { id: F, isAnonymous: false },
};
const SECRET = 'x'.repeat(48);
const ORIGIN = 'https://snipring.com';

function psql(sql: string, vars: Record<string, string> = {}): string {
  const args = ['-u', 'postgres', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync('sudo', args, { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}
const one = (sql: string) => psql(sql);

// ---- fakes
const fault = { finishThrows: 0, uploadFails: 0, deleteUserFails: 0, removeFails: 0 };
const signedOut: string[] = [];
const deps: Deps = {
  async getUser(token) { return TOKENS[token] ?? null; },
  async rpc(op, args) {
    if (op === 'finish' && fault.finishThrows > 0) { fault.finishThrows--; throw new Error('network: response lost'); }
    // exactly how PostgREST calls it: role service_role + JWT claims, one transaction
    const out = psql(`set request.jwt.claims = '{"role":"service_role"}'; set role service_role;
                      select public.svc_library(:'op', :'args'::jsonb);`, { op, args: JSON.stringify(args) });
    return JSON.parse(out);
  },
  async upload(path, bytes) {
    if (fault.uploadFails > 0) { fault.uploadFails--; return { error: '500 storage unavailable' }; }
    if (one(`select count(*) from storage.objects where bucket_id='user-media' and name='${path}'`) !== '0') return 'exists';
    if (bytes.byteLength > 10485760) return { error: '413 Payload too large' };     // bucket limit
    one(`insert into storage.objects (bucket_id, name, metadata) values ('user-media', '${path}',
         jsonb_build_object('size', ${bytes.byteLength}, 'mimetype', 'audio/mpeg'))`);
    return 'ok';
  },
  async signedUrl(path, seconds) { return `https://storage.test/sign/user-media/${path}?expires=${seconds}`; },
  async acct(op, args) {
    const out = psql(`set request.jwt.claims = '{"role":"service_role"}'; set role service_role;
                      select public.svc_account(:'op', :'args'::jsonb);`, { op, args: JSON.stringify(args) });
    return JSON.parse(out);
  },
  async deleteUser(id) {
    if (fault.deleteUserFails > 0) { fault.deleteUserFails--; return { error: '500 auth unavailable' }; }
    try { one(`delete from auth.users where id = '${id}'`); return 'ok'; } catch (e) { return { error: String(e).slice(0, 200) }; }   // like GoTrue: FK errors surface
  },
  async signOutAll(token) { signedOut.push(token); },
  async remove(paths) {
    if (fault.removeFails > 0) { fault.removeFails--; return { error: 'storage unavailable' }; }
    const list = paths.map((p) => `'${p}'`).join(',');
    const out = one(`delete from storage.objects where bucket_id='user-media' and name in (${list}) returning name`);
    return { removed: out ? out.split('\n') : [] };
  },
};
const cfg: Config = { allowedOrigins: [ORIGIN], maxFileBytes: 10485760, signedUrlSeconds: 300, janitorSecret: SECRET, janitorBudgetMs: 30000 };

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function uploadReq(token: string | null, meta: unknown, body: Uint8Array | null, extra: Record<string, string> = {}): Request {
  const h: Record<string, string> = { origin: ORIGIN, 'content-type': 'audio/mpeg', ...extra };
  if (token) h.authorization = `Bearer ${token}`;
  if (meta !== undefined) h['x-library-meta'] = typeof meta === 'string' ? meta : b64url(meta);
  return new Request('https://fn.test/library-upload', { method: 'POST', headers: h, body: body as BodyInit | null });
}
const meta = (o: Record<string, unknown> = {}) => ({ client_key: crypto.randomUUID(), name: 'צלצול', type: 'ring', origin: 'file', ...o });
async function call(res: Promise<Response>) { const r = await res; return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; }
const dl = (token: string, id: string) =>
  call(handleDownload(new Request('https://fn.test/library-download', { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: ORIGIN }, body: JSON.stringify({ id }) }), deps, cfg));
const row = (id: string) => JSON.parse(one(`select to_jsonb(li) from public.library_items li where id = '${id}'`) || 'null');
const objects = (uid: string) => Number(one(`select count(*) from storage.objects where name like '${uid}/%'`));

before(() => {
  execFileSync('sudo', ['-u', 'postgres', 'dropdb', '--if-exists', DB]);
  execFileSync('sudo', ['-u', 'postgres', 'createdb', DB]);
  for (const f of ['tests/stub_supabase.sql', 'schema.sql', 'auth_1a.sql', 'library_1b.sql', 'account_delete.sql', 'beta_invites.sql']) {
    // through stdin, not -f: the postgres OS user may not be allowed to read the checkout (CI runners)
    const r = spawnSync('sudo', ['-u', 'postgres', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB],
      { input: readFileSync(SQL_DIR + f, 'utf8'), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${f}: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
  }
  one(`insert into auth.users (id, is_anonymous) values ('${A}', false), ('${B}', false), ('${C}', false), ('${ANON}', true), ('${E}', false), ('${F}', false);
       insert into private.cloud_access (user_id) values ('${A}'), ('${B}'), ('${ANON}'), ('${E}'), ('${F}');
       update private.settings set value = 'true' where key = 'reservations_open';`);
});

const SONG = siteMp3(44100, 5);
const SONG2 = siteMp3(44100, 6);

test('I1 CORS: preflight answered only for the allowed origin', async () => {
  const ok = await handleUpload(new Request('https://fn.test', { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps, cfg);
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await handleUpload(new Request('https://fn.test', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), deps, cfg);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
test('I2 authentication: missing token, API key instead of session, unknown token, anonymous user → 401', async () => {
  for (const t of [null, 'sb_publishable_abc', 'hdr.forged.sig', 'hdr.anon.sig']) {
    assert.equal((await call(handleUpload(uploadReq(t, meta(), SONG), deps, cfg))).status, 401, String(t));
  }
});
test('I3 malformed metadata → 400 (bad key, bad type, bad origin, not JSON, oversized name)', async () => {
  for (const m of [meta({ client_key: 'nope' }), meta({ type: 'malware' }), meta({ origin: 'x' }), '%%%', meta({ name: 'a'.repeat(201) }), meta({ allow_duplicate: 'yes' })]) {
    assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', m, SONG), deps, cfg))).status, 400, JSON.stringify(m));
  }
});
// a request body that arrives in many small, delayed chunks and records how much was pulled
function slowBody(total: number) {
  const s = { pulled: 0, closed: false, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 0));
      const n = Math.min(256 * 1024, total - s.pulled);
      if (n <= 0) { s.closed = true; c.close(); return; }
      s.pulled += n; c.enqueue(new Uint8Array(n));
    },
    cancel() { s.cancelled = true; },
  });
  return { stream, s };
}
function streamReq(token: string, body: ReadableStream<Uint8Array>, extra: Record<string, string> = {}): Request {
  return new Request('https://fn.test', { method: 'POST', body, duplex: 'half',
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN, 'x-library-meta': b64url(meta()), ...extra } } as RequestInit);
}
test('I4 size cap: declared too large → 413 without reading; streamed too large → 413', async () => {
  const r1 = await call(handleUpload(uploadReq('hdr.userA.sig', meta(), SONG, { 'content-length': '20000000' }), deps, cfg));
  assert.equal(r1.status, 413);
  const big = new Uint8Array(10485761);
  const stream = new ReadableStream({ start(c) { c.enqueue(big.subarray(0, 6e6)); c.enqueue(big.subarray(6e6)); c.close(); } });
  const req = new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer hdr.userA.sig', 'x-library-meta': b64url(meta()) }, body: stream, duplex: 'half' } as RequestInit);
  assert.equal((await call(handleUpload(req, deps, cfg))).status, 413);
});
// staging T9b: a refusal answered while the client was still sending the file hung until the 150 s
// wall clock. Every refusal must read the rest of the body (bounded) BEFORE the response is returned.
test('I4b refusals drain the unread body before answering (declared, streamed, 401, 400, download, janitor)', async () => {
  const MiB = 1024 * 1024;
  const cases: [string, (b: ReadableStream<Uint8Array>) => Promise<Response>, number, number][] = [
    ['413 by content-length', (b) => handleUpload(streamReq('hdr.userA.sig', b, { 'content-length': String(11 * MiB) }), deps, cfg), 11 * MiB, 413],
    ['413 streamed, no length', (b) => handleUpload(streamReq('hdr.userA.sig', b), deps, cfg), 11 * MiB, 413],
    ['401 forged token', (b) => handleUpload(streamReq('hdr.forged.sig', b), deps, cfg), 3 * MiB, 401],
    ['400 bad metadata', (b) => handleUpload(streamReq('hdr.userA.sig', b, { 'x-library-meta': '%%%' }), deps, cfg), 3 * MiB, 400],
    ['download 401', (b) => handleDownload(streamReq('hdr.forged.sig', b), deps, cfg), 48 * 1024, 401],
    ['janitor 401', (b) => handleJanitor(streamReq('wrong', b), deps, cfg), 48 * 1024, 401],
  ];
  for (const [name, run, total, status] of cases) {
    const { stream, s } = slowBody(total);
    const res = await run(stream);
    assert.equal(res.status, status, name);
    assert.equal(s.pulled, total, `${name}: whole body read before the response was returned`);
    assert.equal(s.closed, true, name);
  }
  // declared beyond the drain limit (10 MiB + 1 MiB for uploads): cancelled without reading it
  const declared = slowBody(25 * MiB);
  assert.equal((await handleUpload(streamReq('hdr.userA.sig', declared.stream, { 'content-length': String(25 * MiB) }), deps, cfg)).status, 413);
  assert.equal(declared.s.cancelled, true);
  assert.ok(declared.s.pulled <= 512 * 1024, `declared 25 MiB: pulled ${declared.s.pulled}`);
  // streamed without a length: read up to the drain limit, then cancelled
  const streamed = slowBody(25 * MiB);
  assert.equal((await handleUpload(streamReq('hdr.userA.sig', streamed.stream), deps, cfg)).status, 413);
  assert.equal(streamed.s.cancelled, true);
  assert.ok(streamed.s.pulled <= 11 * MiB + 512 * 1024, `streamed 25 MiB: pulled ${streamed.s.pulled}`);
  // malformed content-length: refused, cancelled unread
  const bad = slowBody(3 * MiB);
  assert.equal((await handleUpload(streamReq('hdr.userA.sig', bad.stream, { 'content-length': '12abc' }), deps, cfg)).status, 413);
  assert.ok(bad.s.pulled <= 512 * 1024, `malformed length: pulled ${bad.s.pulled}`);
});
// a refusal decided from headers alone must not cost a call to Supabase Auth
test('I4c refused by content-length or metadata → no getUser call', async () => {
  let calls = 0;
  const counted: Deps = { ...deps, getUser: async (t) => { calls++; return deps.getUser(t); } };
  assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', meta(), SONG, { 'content-length': '20000000' }), counted, cfg))).status, 413);
  assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', '%%%', SONG), counted, cfg))).status, 400);
  assert.equal((await call(handleUpload(uploadReq(null, meta({ type: 'malware' }), SONG), counted, cfg))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await call(handleUpload(uploadReq('hdr.forged.sig', meta(), SONG), counted, cfg))).status, 401);
  assert.equal(calls, 1);
});
test('I5 not an MP3 (WAV renamed) → 415, nothing reserved', async () => {
  const r = await call(handleUpload(uploadReq('hdr.userA.sig', meta(), ffmpeg([...sine(2), '-f', 'wav'])), deps, cfg));
  assert.equal(r.status, 415);
  assert.equal(one(`select count(*) from public.library_items where user_id='${A}'`), '0');
});
test('I6 6-minute MP3 → 422 bad_duration (duration measured on the server)', async () => {
  const long = ffmpeg([...sine(360), '-ac', '1', '-ar', '8000', '-c:a', 'libmp3lame', '-b:a', '8k', '-f', 'mp3']);
  assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', meta(), long), deps, cfg))).status, 422);
});

let firstId = '';
test('I7 happy path: ready, object at <uid>/<id>.mp3, size/sha/duration measured by the server', async () => {
  const m = meta({ name: '../../etc/passwd\u0000' });
  const r = await call(handleUpload(uploadReq('hdr.userA.sig', m, SONG), deps, cfg));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'ready');
  firstId = r.body.id;
  const x = row(firstId);
  assert.equal(x.state, 'ready');
  assert.equal(x.storage_path, `${A}/${firstId}.mp3`);
  assert.equal(x.size_bytes, SONG.byteLength);
  assert.ok(Math.abs(x.duration_ms - 5000) < 100);
  assert.equal(x.content_sha256, (await import('node:crypto')).createHash('sha256').update(SONG).digest('hex'));
  assert.equal(x.name, '../../etc/passwd');                // just a label; never used in a path
  assert.equal(objects(A), 1);
  // same job again (lost response) → same id, nothing new stored
  const again = await call(handleUpload(uploadReq('hdr.userA.sig', m, SONG), deps, cfg));
  assert.equal(again.body.id, firstId); assert.equal(objects(A), 1);
});
test('I8 same content, new job → duplicate; allow_duplicate → second copy', async () => {
  const d = await call(handleUpload(uploadReq('hdr.userA.sig', meta(), SONG), deps, cfg));
  assert.equal(d.body.status, 'duplicate'); assert.equal(d.body.id, firstId);
  const k = await call(handleUpload(uploadReq('hdr.userA.sig', meta({ allow_duplicate: true }), SONG), deps, cfg));
  assert.equal(k.body.status, 'ready'); assert.notEqual(k.body.id, firstId);
});
test('I9 storage failure → 502 retryable; retry with OTHER bytes on the same key → 409; same bytes → ready', async () => {
  const m = meta();
  fault.uploadFails = 1;
  const r1 = await call(handleUpload(uploadReq('hdr.userA.sig', m, SONG2), deps, cfg));
  assert.equal(r1.status, 502); assert.equal(r1.body.retryable, true);
  assert.equal(row(r1.body.id).state, 'uploading');
  const r2 = await call(handleUpload(uploadReq('hdr.userA.sig', m, siteMp3(44100, 7)), deps, cfg));
  assert.equal(r2.status, 409); assert.equal(r2.body.error, 'client_key_conflict');
  const r3 = await call(handleUpload(uploadReq('hdr.userA.sig', m, SONG2), deps, cfg));
  assert.equal(r3.body.status, 'ready'); assert.equal(r3.body.id, r1.body.id);
});
test('I10 response lost after the object was stored → retry finds the object ("exists") and finishes', async () => {
  const m = meta(); const song = siteMp3(44100, 8);
  fault.finishThrows = 1;
  const r1 = await call(handleUpload(uploadReq('hdr.userA.sig', m, song), deps, cfg));
  assert.equal(r1.status, 500); assert.equal(r1.body.retryable, true);
  const r2 = await call(handleUpload(uploadReq('hdr.userA.sig', m, song), deps, cfg));
  assert.equal(r2.body.status, 'ready');
});
test('I11 download: owner gets a 300 s signed URL; other user, bad id, deleted item → refused', async () => {
  const ok = await dl('hdr.userA.sig', firstId);
  assert.equal(ok.status, 200); assert.equal(ok.body.expires_in, 300); assert.match(ok.body.url, new RegExp(`${A}/${firstId}\\.mp3`));
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await dl('hdr.userB.sig', firstId)).status, 404);
  assert.equal((await dl('hdr.userA.sig', 'not-a-uuid')).status, 400);
  assert.equal((await dl('hdr.forged.sig', firstId)).status, 401);
});
test('I12 account switch: B reusing A\'s client_key gets its own job and cannot touch A\'s', async () => {
  const m = meta();
  const a = await call(handleUpload(uploadReq('hdr.userA.sig', m, siteMp3(44100, 9)), deps, cfg));
  const b = await call(handleUpload(uploadReq('hdr.userB.sig', m, siteMp3(44100, 9)), deps, cfg));
  assert.equal(a.body.status, 'ready'); assert.equal(b.body.status, 'ready');
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(row(b.body.id).user_id, B); assert.equal(row(a.body.id).user_id, A);
});
test('I13 user outside the beta allow-list → 403 not_enabled', async () => {
  const r = await call(handleUpload(uploadReq('hdr.userC.sig', meta(), SONG), deps, cfg));
  assert.equal(r.status, 403); assert.equal(r.body.error, 'not_enabled');
});
test('I14 switches: reservations closed → 503; emergency stop → 503 but download still works', async () => {
  one(`update private.settings set value='false' where key='reservations_open'`);
  assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', meta(), siteMp3(44100, 2)), deps, cfg))).body.error, 'reservations_closed');
  one(`update private.settings set value='true' where key='reservations_open'; update private.settings set value='true' where key='emergency_stop'`);
  assert.equal((await call(handleUpload(uploadReq('hdr.userA.sig', meta(), siteMp3(44100, 2)), deps, cfg))).body.error, 'stopped');
  assert.equal((await dl('hdr.userA.sig', firstId)).status, 200);
  one(`update private.settings set value='false' where key='emergency_stop'`);
});
test('I15 janitor auth: wrong secret → 401; weak configured secret → refuses to run', async () => {
  const j = (s: string, c = cfg) => handleJanitor(new Request('https://fn.test', { method: 'POST', headers: { authorization: `Bearer ${s}` } }), deps, c);
  assert.equal((await j('wrong')).status, 401);
  assert.equal((await j('short', { ...cfg, janitorSecret: 'short' })).status, 500);
  assert.equal((await j('')).status, 401);
});
test('I16 janitor: deletes, expired reservations and orphans are cleaned through the Storage API', async () => {
  // a deleted item past its grace period
  one(`set role authenticated; set request.jwt.claims = '{"role":"authenticated","sub":"${A}"}'; select public.library_delete('${firstId}');`);
  one(`update public.library_items set purge_next_at = now() - interval '1 second' where id = '${firstId}'`);
  // an expired reservation (upload never finished)
  fault.uploadFails = 1;
  const exp = await call(handleUpload(uploadReq('hdr.userB.sig', meta(), siteMp3(44100, 3)), deps, cfg));
  one(`update public.library_items set expires_at = now() - interval '1 second' where id = '${exp.body.id}'`);
  // an orphaned object (no row), 2 hours old
  one(`insert into storage.objects (bucket_id, name, metadata, created_at) values ('user-media', '${B}/orphan.mp3', '{"size":10,"mimetype":"audio/mpeg"}', now() - interval '2 hours')`);
  const before = objects(A);
  const res = await call(handleJanitor(new Request('https://fn.test', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), deps, cfg));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.purged, 1); assert.equal(res.body.expired, 1); assert.equal(res.body.orphans, 1);
  assert.equal(row(firstId).state, 'purged'); assert.equal(objects(A), before - 1);
  assert.equal(row(exp.body.id).state, 'abandoned');
  assert.equal(one(`select count(*) from storage.objects where name = '${B}/orphan.mp3'`), '0');
  assert.equal(one(`select bytes_releasing from private.library_usage where user_id = '${A}'`), '0');
});
test('I16b janitor prunes usage rows that hold nothing (stray rows would block account deletion)', async () => {
  one(`insert into private.library_usage (user_id) values ('${C}')`);            // as the pre-fix library_delete left it
  const r = await runJanitor(deps, { ...cfg, holder: 'prune' });
  assert.ok(r && r.pruned >= 1, JSON.stringify(r));
  assert.equal(one(`select count(*) from private.library_usage where user_id = '${C}'`), '0');
  assert.equal(one(`select count(*) from private.library_usage where user_id in ('${A}', '${B}')`), '2');   // rows with data stay
});
test('I17 two janitor runs at once: only one does the work', async () => {
  const [x, y] = await Promise.all([runJanitor(deps, { ...cfg, holder: 'r1' }), runJanitor(deps, { ...cfg, holder: 'r2' })]);
  assert.equal([x, y].filter((v) => v === null).length, 1);
});
test('I18 end state: counters equal rows for every user', () => {
  assert.equal(one(`set request.jwt.claims = '{"role":"service_role"}';
    select count(*) filter (where public.svc_library('audit_user', jsonb_build_object('user_id', user_id)) = 'true'::jsonb)
      from private.library_usage`), '0');
});

// ------------------------------------------------------------------ account deletion
const delReq = (token: string | null, body: unknown = { confirm: 'delete-my-account' }) => {
  const h: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request('https://fn.test/account-delete', { method: 'POST', headers: h, body: JSON.stringify(body) });
};
const userExists = (id: string) => one(`select count(*) from auth.users where id = '${id}'`) === '1';
const ad = (id: string) => JSON.parse(one(`select to_jsonb(d) from private.account_deletions d where user_id = '${id}'`) || 'null');

test('AD1 account-delete refuses without a session, with an API key, or without the confirmation word', async () => {
  assert.equal((await call(handleAccountDelete(delReq(null), deps, cfg))).status, 401);
  assert.equal((await call(handleAccountDelete(delReq('sb_secret_abc'), deps, cfg))).status, 401);
  assert.equal((await call(handleAccountDelete(delReq('hdr.anon.sig'), deps, cfg))).status, 401);
  assert.equal((await call(handleAccountDelete(delReq('hdr.userE.sig', {}), deps, cfg))).status, 400);
  assert.equal((await call(handleAccountDelete(delReq('hdr.userE.sig', { confirm: 'yes' }), deps, cfg))).status, 400);
  assert.ok(userExists(E)); assert.equal(ad(E), null);
});
test('AD2 a user id in the body is ignored: only the session decides whose account goes', async () => {
  const r = await call(handleAccountDelete(delReq('hdr.userE.sig', { confirm: 'yes', user_id: A }), deps, cfg));
  assert.equal(r.status, 400); assert.ok(userExists(A)); assert.equal(ad(A), null);
});
test('AD3 deleting an account with media: objects removed, quota rows gone, Auth user deleted, other users untouched', async () => {
  const s1 = await call(handleUpload(uploadReq('hdr.userE.sig', meta(), siteMp3(44100, 3)), deps, cfg));
  const s2 = await call(handleUpload(uploadReq('hdr.userE.sig', meta(), siteMp3(44100, 4)), deps, cfg));
  assert.equal(s1.status, 200); assert.equal(s2.status, 200);
  // one more upload left half-way (reserved, never finished)
  fault.uploadFails = 1;
  const s3 = await call(handleUpload(uploadReq('hdr.userE.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(s3.status, 502);
  assert.equal(objects(E), 2);
  const othersBefore = objects(A) + objects(B);
  const res = await call(handleAccountDelete(delReq('hdr.userE.sig'), deps, cfg));
  assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(res.body.status, 'deleted');
  assert.equal(objects(E), 0);
  assert.ok(!userExists(E));
  assert.equal(one(`select count(*) from public.library_items where user_id = '${E}'`), '0');
  assert.equal(one(`select count(*) from private.library_usage where user_id = '${E}'`), '0');
  assert.equal(one(`select count(*) from private.cloud_access where user_id = '${E}'`), '0');
  assert.equal(one(`select count(*) from public.profiles where id = '${E}'`), '0');
  assert.equal(ad(E).state, 'done');
  // only the proof event stays in the technical log
  assert.equal(one(`select string_agg(kind, ',') from private.library_events where user_id = '${E}'`), 'account_deleted');
  assert.ok(signedOut.includes('hdr.userE.sig'));
  assert.equal(objects(A) + objects(B), othersBefore);
});
test('AD4 a deleted account cannot upload again with an old token (user is gone)', async () => {
  // the fake getUser still knows the token, like a JWT that has not expired yet; SQL refuses anyway
  const r = await call(handleUpload(uploadReq('hdr.userE.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(r.status, 403); assert.equal(r.body.error, 'not_enabled');
});
test('AD5 Storage or Auth failing: the request stays pending, the janitor finishes it later', async () => {
  const s1 = await call(handleUpload(uploadReq('hdr.userF.sig', meta(), siteMp3(44100, 3)), deps, cfg));
  assert.equal(s1.status, 200);
  fault.removeFails = 5;
  const res = await call(handleAccountDelete(delReq('hdr.userF.sig'), deps, cfg));
  assert.equal(res.status, 200); assert.equal(res.body.status, 'pending');
  assert.ok(userExists(F)); assert.equal(objects(F), 1);
  // the Auth user cannot be deleted by accident while media exists (RESTRICT)
  assert.notEqual(await deps.deleteUser!(F), 'ok');
  assert.equal(ad(F).state, 'pending');
  // new uploads are refused while the request is pending
  const again = await call(handleUpload(uploadReq('hdr.userF.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(again.body.error, 'not_enabled');
  fault.removeFails = 0; fault.deleteUserFails = 1;
  one(`update private.account_deletions set next_at = now() where user_id = '${F}'`);
  one(`update public.library_items set purge_next_at = now() where user_id = '${F}' and state in ('deleting','abandoned')`);
  const r1 = await runJanitor(deps, { ...cfg, holder: 'acct1' });
  assert.ok(r1); assert.equal(r1.accounts, 0);                      // objects gone, Auth failed once → backed off
  assert.equal(objects(F), 0); assert.ok(userExists(F));
  assert.equal(ad(F).attempts, 1); assert.match(ad(F).last_error, /auth unavailable/);
  one(`update private.account_deletions set next_at = now() where user_id = '${F}'`);
  const r2 = await runJanitor(deps, { ...cfg, holder: 'acct2' });
  assert.ok(r2); assert.equal(r2.accounts, 1);
  assert.ok(!userExists(F)); assert.equal(ad(F).state, 'done');
});
test('AD6 svc_account is service_role only; private account tables are unreachable', () => {
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => psql(`set role ${role}; select public.svc_account('due', '{}');`), /permission denied/);
    assert.throws(() => psql(`set role ${role}; select * from private.account_deletions;`), /permission denied/);
  }
  // service_role grant alone is not enough: the JWT role claim must say so too
  assert.throws(() => psql(`set role service_role; select public.svc_account('due', '{}');`), /service role required|permission denied/);
});
test('AD7 end state after deletions: counters equal rows for every remaining user', () => {
  assert.equal(one(`set request.jwt.claims = '{"role":"service_role"}';
    select count(*) filter (where public.svc_library('audit_user', jsonb_build_object('user_id', user_id)) = 'true'::jsonb)
      from private.library_usage`), '0');
});

// ------------------------------------------------------------------ health (alerting)
const HSECRET = 'h'.repeat(40);
const health = (token: string | null, c: Partial<Config> = {}) =>
  call(handleHealth(new Request('https://fn.test/library-health', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }), deps, { ...cfg, healthSecret: HSECRET, ...c }));

test('H1 health refuses without its secret, with the janitor secret, and when not configured', async () => {
  assert.equal((await health(null)).status, 401);
  assert.equal((await health(SECRET)).status, 401);
  assert.equal((await health(HSECRET, { healthSecret: 'short' })).status, 500);
});
test('H2 healthy after a janitor run: ok, only yes/no fields, no user data', async () => {
  await runJanitor(deps, { ...cfg, holder: 'h2' });
  const r = await health(HSECRET);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(Object.values(r.body.checks).every((v) => typeof v === 'boolean'));
  assert.ok(!JSON.stringify(r.body).match(/[0-9a-f]{8}-[0-9a-f]{4}-/));        // no ids anywhere
});
test('H3 real problems flip ok to false and name the check', async () => {
  // a stuck deletion (older than 24 h) and an untracked object (stored > counted)
  const s = await call(handleUpload(uploadReq('hdr.userB.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  one(`update public.library_items set state = 'deleting', deleted_at = now() - interval '2 days', updated_at = now() - interval '2 days',
         purge_next_at = now() + interval '1 day' where id = '${s.body.id}'`);
  one(`insert into storage.objects (bucket_id, name, metadata) values ('user-media', '${B}/untracked.mp3', '{"size":999999,"mimetype":"audio/mpeg"}')`);
  const r = await health(HSECRET);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.failing.includes('no_stuck_deletes'), JSON.stringify(r.body));
  assert.ok(r.body.failing.includes('bytes_tracked'), JSON.stringify(r.body));
  // janitor silence is a problem too
  one(`delete from private.library_events where kind = 'janitor_run'`);
  assert.ok((await health(HSECRET)).body.failing.includes('janitor_recent'));
  // clean up for later tests
  one(`delete from storage.objects where name = '${B}/untracked.mp3'`);
  one(`update public.library_items set purge_next_at = now() where id = '${s.body.id}'`);
  await runJanitor(deps, { ...cfg, holder: 'h3' });
  assert.equal((await health(HSECRET)).body.ok, true);
});

// ------------------------------------------------------------------ beta invites (M6)
const G = '00000000-0000-0000-0000-0000000000a7';   // invited user
const asUser = (uid: string, sql: string) => psql(`set request.jwt.claims = '{"role":"authenticated","sub":"${uid}"}'; set role authenticated; ${sql}`);
const redeem = (uid: string, code: string) => asUser(uid, `select public.beta_redeem('${code.replace(/'/g, "''")}');`);

test('B1 owner creates a code: shown once, only its hash is stored', () => {
  one(`insert into auth.users (id, is_anonymous) values ('${G}', false) on conflict do nothing`);
  const code = one(`select private.create_invite(2, 14, 'test')`);
  assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(one(`select count(*) from private.beta_invites where code_hash = private.invite_hash('${code}')`), '1');
  assert.equal(one(`select count(*) from private.beta_invites where code_hash like '%${code.replace(/-/g, '')}%' or note = '${code}'`), '0');
  (globalThis as any).__code = code;
});
test('B2 API roles cannot read invites or create codes', () => {
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => psql(`set role ${role}; select * from private.beta_invites;`), /permission denied/);
    assert.throws(() => psql(`set role ${role}; select private.create_invite(1, 1, null);`), /permission denied/);
  }
  assert.throws(() => psql(`set role anon; select public.beta_redeem('x');`), /permission denied/);
});
test('B3 redeem: wrong code neutral, right code joins the beta (case and dashes ignored), idempotent', () => {
  const code: string = (globalThis as any).__code;
  assert.equal(redeem(G, 'NOPE-NOPE-NOPE-NOPE'), 'invalid');
  assert.equal(one(`select count(*) from private.cloud_access where user_id = '${G}'`), '0');
  assert.equal(redeem(G, code.toLowerCase().replace(/-/g, ' ')), 'ok');
  assert.equal(one(`select count(*) from private.cloud_access where user_id = '${G}'`), '1');
  assert.equal(redeem(G, code), 'already');
  assert.equal(one(`select uses_left from private.beta_invites where code_hash = private.invite_hash('${code}')`), '1');
  assert.equal(one(`select count(*) from private.library_events where user_id = '${G}' and kind = 'invite_redeemed'`), '1');
});
test('B4 used-up and expired codes are refused with the same answer', () => {
  const code: string = (globalThis as any).__code;
  one(`insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000a8', false), ('00000000-0000-0000-0000-0000000000a9', false) on conflict do nothing`);
  assert.equal(redeem('00000000-0000-0000-0000-0000000000a8', code), 'ok');        // last use
  assert.equal(redeem('00000000-0000-0000-0000-0000000000a9', code), 'invalid');   // used up
  const old = one(`select private.create_invite(5, 1, null)`);
  one(`update private.beta_invites set expires_at = now() - interval '1 minute' where code_hash = private.invite_hash('${old}')`);
  assert.equal(redeem('00000000-0000-0000-0000-0000000000a9', old), 'invalid');
});
test('B5 ten failed tries per hour, then refused even with a valid code', () => {
  const U = '00000000-0000-0000-0000-0000000000aa';
  one(`insert into auth.users (id, is_anonymous) values ('${U}', false) on conflict do nothing`);
  for (let i = 0; i < 10; i++) assert.equal(redeem(U, `BAD-${i}`), 'invalid');
  const good = one(`select private.create_invite(1, 1, null)`);
  assert.equal(redeem(U, good), 'rate_limited');
  assert.equal(one(`select count(*) from private.cloud_access where user_id = '${U}'`), '0');
});

// ------------------------------------------------------------------ public launch switch
test('P1 cloud_for_all: a user outside the allow-list can save; usage says enabled', async () => {
  const P = '00000000-0000-0000-0000-0000000000ab';
  TOKENS['hdr.userP.sig'] = { id: P, isAnonymous: false };
  one(`insert into auth.users (id, is_anonymous) values ('${P}', false) on conflict do nothing`);
  const before = await call(handleUpload(uploadReq('hdr.userP.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(before.body.error, 'not_enabled');
  one(`insert into private.settings (key, value) values ('cloud_for_all', 'true') on conflict (key) do update set value = 'true'`);
  const after = await call(handleUpload(uploadReq('hdr.userP.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(after.status, 200, JSON.stringify(after.body));
  assert.equal(asUser(P, `select (public.library_usage() ->> 'enabled')`), 'true');
});
test('P2 with cloud_for_all on, an account being deleted still cannot start uploads', async () => {
  const Q = '00000000-0000-0000-0000-0000000000ac';
  TOKENS['hdr.userQ.sig'] = { id: Q, isAnonymous: false };
  one(`insert into auth.users (id, is_anonymous) values ('${Q}', false) on conflict do nothing`);
  one(`insert into private.account_deletions (user_id) values ('${Q}')`);       // pending
  const r = await call(handleUpload(uploadReq('hdr.userQ.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  assert.equal(r.body.error, 'not_enabled');
  one(`delete from private.account_deletions where user_id = '${Q}'`);
  one(`update private.settings set value = 'false' where key = 'cloud_for_all'`);
});

// ------------------------------------------------------------------ media backup (Cloudflare R2)
const r2 = new Map<string, { size: number; modified: number }>();
const r2fault = { delFails: 0 };
const depsB: Deps = {
  ...deps,
  async download(path) {
    const size = one(`select (metadata ->> 'size') from storage.objects where bucket_id = 'user-media' and name = '${path}'`);
    return size ? new Uint8Array(Number(size)) : null;
  },
  backup: {
    async put(key, bytes) { r2.set(key, { size: bytes.byteLength, modified: Date.now() }); return 'ok'; },
    async del(key) { if (r2fault.delFails > 0) { r2fault.delFails--; return { error: 'r2 delete 500' }; } r2.delete(key); return 'ok'; },
    async list() { return { keys: [...r2.entries()].map(([key, v]) => ({ key, modified: v.modified })) }; },
  },
};

test('R1 janitor copies every ready object to the backup once and marks it', async () => {
  const s1 = await call(handleUpload(uploadReq('hdr.userA.sig', meta(), siteMp3(44100, 3)), deps, cfg));
  assert.equal(s1.status, 200);
  const r1 = await runJanitor(depsB, { ...cfg, holder: 'r1' });
  assert.ok(r1 && r1.backup === 'on' && (r1.backed_up ?? 0) >= 1, JSON.stringify(r1));
  assert.ok(r2.has(row(s1.body.id).storage_path));
  assert.ok(row(s1.body.id).backup_at);
  assert.equal(one(`select count(*) from public.library_items where state = 'ready' and backup_at is null`), '0');
  const r1b = await runJanitor(depsB, { ...cfg, holder: 'r1b' });
  assert.equal(r1b!.backed_up, 0);
  (globalThis as any).__r1 = s1.body.id;
});
test('R2 deleting: the backup copy goes first; if it cannot be removed the item is NOT purged', async () => {
  const id = (globalThis as any).__r1, path = row(id).storage_path;
  assert.equal(asUser(A, `select public.library_delete('${id}')`), 'deleting');
  one(`update public.library_items set purge_next_at = now() where id = '${id}'`);
  r2fault.delFails = 1;
  await runJanitor(depsB, { ...cfg, holder: 'r2a' });
  assert.equal(row(id).state, 'deleting'); assert.ok(r2.has(path));
  assert.equal(one(`select count(*) from storage.objects where name = '${path}'`), '1');      // Storage copy kept too
  one(`update public.library_items set purge_next_at = now() where id = '${id}'`);
  await runJanitor(depsB, { ...cfg, holder: 'r2b' });
  assert.equal(row(id).state, 'purged'); assert.ok(!r2.has(path));
  assert.equal(one(`select count(*) from storage.objects where name = '${path}'`), '0');
});
test('R3 backup orphans: old keys with no live row are removed; recent ones and live ones stay', async () => {
  const s2 = await call(handleUpload(uploadReq('hdr.userB.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  await runJanitor(depsB, { ...cfg, holder: 'r3a' });
  const live = row(s2.body.id).storage_path;
  r2.set(`${B}/gone-old.mp3`, { size: 1, modified: Date.now() - 2 * 3600_000 });
  r2.set(`${B}/gone-new.mp3`, { size: 1, modified: Date.now() });
  r2.set(live, { size: 1, modified: Date.now() - 2 * 3600_000 });
  const r = await runJanitor(depsB, { ...cfg, holder: 'r3b' });
  assert.equal(r!.backup_orphans, 1);
  assert.ok(!r2.has(`${B}/gone-old.mp3`)); assert.ok(r2.has(`${B}/gone-new.mp3`)); assert.ok(r2.has(live));
  r2.delete(`${B}/gone-new.mp3`);
});
test('R4 health: backup lag counts only when the backup is enabled', () => {
  one(`update public.library_items set backup_at = null, created_at = created_at - interval '3 hours' where state = 'ready' and user_id = '${B}'`);
  const h = () => JSON.parse(one(`set request.jwt.claims = '{"role":"service_role"}'; select private.ops_health()`));
  assert.equal(h().backup_current, true);                                   // backup_enabled false
  one(`update private.settings set value = 'true' where key = 'backup_enabled'`);
  assert.equal(h().backup_current, false);
  one(`update private.settings set value = 'false' where key = 'backup_enabled'`);
  one(`update public.library_items set backup_at = now() where state = 'ready' and user_id = '${B}'`);
});

// ------------------------------------------------------------------ owner alert e-mails (janitor step 10)
test('H5 janitor e-mails the owner once when something is wrong, then waits 6 hours; nothing when healthy', async () => {
  const mails: string[] = [];
  const depsM: Deps = { ...deps, async sendAlert(subject) { mails.push(subject); return 'ok'; } };
  await runJanitor(depsM, { ...cfg, holder: 'h5a' });
  assert.equal(mails.length, 0);                                            // healthy: silence
  const s = await call(handleUpload(uploadReq('hdr.userA.sig', meta(), siteMp3(44100, 2)), deps, cfg));
  // a deletion stuck for 2 days (deleted the real way, so the counters stay right)
  assert.equal(asUser(A, `select public.library_delete('${s.body.id}')`), 'deleting');
  one(`update public.library_items set deleted_at = now() - interval '2 days', updated_at = now() - interval '2 days',
         purge_next_at = now() + interval '1 day' where id = '${s.body.id}'`);
  const r1 = await runJanitor(depsM, { ...cfg, holder: 'h5b' });
  assert.equal(r1!.alert, 'sent'); assert.equal(mails.length, 1); assert.match(mails[0], /no_stuck_deletes/);
  const r2 = await runJanitor(depsM, { ...cfg, holder: 'h5c' });
  assert.equal(r2!.alert, 'throttled'); assert.equal(mails.length, 1);
  // a failed send is retried on the next run (nothing recorded as sent)
  one(`delete from private.library_events where kind = 'alert_sent'`);
  const depsF: Deps = { ...deps, async sendAlert() { return { error: 'resend 500' }; } };
  assert.equal((await runJanitor(depsF, { ...cfg, holder: 'h5d' }))!.alert, 'failed');
  assert.equal(one(`select count(*) from private.library_events where kind = 'alert_sent'`), '0');
  one(`update public.library_items set purge_next_at = now() where id = '${s.body.id}'`);
  await runJanitor(deps, { ...cfg, holder: 'h5e' });
});

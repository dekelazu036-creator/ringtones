// Loads the REAL Deno entry points (index.ts + supabase.ts) with a fake Deno global and a recording
// fake of supabase-js, to check the wiring: which key is used, what is sent to rpc/storage, options.
// Run with:  node --import ./tests/shim/register.mjs --test tests/wiring.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteMp3 } from './fixtures.ts';

const env: Record<string, string> = {
  SUPABASE_URL: 'https://stagingref.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_TESTONLY' }),
  SUPABASE_SERVICE_ROLE_KEY: 'legacy-should-not-be-used',
  ALLOWED_ORIGINS: 'https://snipring.com, https://staging.example',
  JANITOR_SECRET: 'j'.repeat(40) + '\n',
  HEALTH_SECRET: 'k'.repeat(40) + '\n',
  R2_ENDPOINT: 'https://acct123.eu.r2.cloudflarestorage.com', R2_BUCKET: 'snipring-media-backup',
  R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'r2secretTEST',
  RESEND_API_KEY: 're_TESTKEY', ALERT_EMAIL: 'owner@example.invalid',                // pasted in the dashboard with a trailing newline
};
const handlers: Record<string, (r: Request) => Promise<Response>> = {};
let current = '';
(globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: any) => { handlers[current] = h; } };
const fake = (globalThis as any).__fake = {
  created: [] as any[], calls: [] as any[],
  getUser: async (t: string) => (t === 'h.ok.s' ? { data: { user: { id: '00000000-0000-0000-0000-0000000000a1', is_anonymous: false } }, error: null }
                                                 : { data: { user: null }, error: { message: 'invalid JWT' } }),
  rpc: async (_fn: string, a: any) => {
    if (a.p_op === 'begin') return { data: { status: 'upload', id: '11111111-1111-1111-1111-111111111111',
      path: '00000000-0000-0000-0000-0000000000a1/11111111-1111-1111-1111-111111111111.mp3', size: a.p_args.size, sha256: a.p_args.sha256 }, error: null };
    if (a.p_op === 'finish') return { data: { status: 'done' }, error: null };
    if (a.p_op === 'ready_item') return { data: { path: '00000000-0000-0000-0000-0000000000a1/11111111-1111-1111-1111-111111111111.mp3', name: 'צלצול' }, error: null };
    if (a.p_op === 'janitor_acquire') return { data: true, error: null };
    if (a.p_op === 'due_purges') return { data: [{ id: '22222222-2222-2222-2222-222222222222', path: 'u/x.mp3' }], error: null };
    if (a.p_op === 'purged') return { data: 'purged', error: null };
    if (['expired', 'orphans', 'audit_due'].includes(a.p_op)) return { data: [], error: null };
    if (a.p_op === 'drop_tombstones' || a.p_op === 'prune_usage') return { data: 0, error: null };
    if (a.p_op === 'backup_due') return { data: [{ id: '33333333-3333-3333-3333-333333333333', path: 'u/b.mp3' }], error: null };
    if (a.p_op === 'backup_done') return { data: true, error: null };
    if (a.p_op === 'live_paths') return { data: [], error: null };
    if (_fn === 'svc_account') {
      if (a.p_op === 'due') return { data: [], error: null };
      if (a.p_op === 'request') return { data: { status: 'pending', items: 0 }, error: null };
      if (a.p_op === 'purges') return { data: [], error: null };
      if (a.p_op === 'prepare') return { data: 'ready', error: null };
      if (a.p_op === 'done') return { data: 'done', error: null };
      if (a.p_op === 'health') return { data: { janitor_recent: true, no_stuck_deletes: !(globalThis as any).__fake.healthBad, uploads_paused: false }, error: null };
      if (a.p_op === 'alert_due') return { data: true, error: null };
      if (a.p_op === 'alert_sent') return { data: true, error: null };
    }
    return { data: true, error: null };
  },
  upload: async () => ({ data: null, error: { statusCode: '409', message: 'The resource already exists' } }),
};

// R2 (S3 API) is reached with fetch: a recording stub for every test, so nothing leaves the machine
const r2seen: { url: string; method: string; auth: string; body: number }[] = [];
globalThis.fetch = (async (url: string, init: any = {}) => {
  r2seen.push({ url: String(url), method: init.method, auth: init.headers?.authorization ?? '', body: init.body?.byteLength ?? (typeof init.body === 'string' ? init.body : 0) });
  if (init.method === 'GET') return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 });
  return new Response('', { status: 200 });
}) as any;

// TARGET=dist checks the generated single-file bundles instead of the source entry points
const dist = process.env.TARGET === 'dist';
async function load(name: string) {
  current = name;
  await import(dist ? `../dist/${name}.ts` : `../${name}/index.ts`);
  return handlers[name];
}

test('W1 secret key comes from SUPABASE_SECRET_KEYS.default (not the legacy key), sessions off', async () => {
  await load('library-upload');
  assert.equal(fake.created[0].key, 'sb_secret_TESTONLY');
  assert.equal(fake.created[0].url, 'https://stagingref.supabase.co');
  assert.equal(fake.created[0].opts.auth.persistSession, false);
  assert.equal(fake.created[0].opts.auth.autoRefreshToken, false);
});
test('W2 upload: rpc svc_library(p_op,p_args), measured size/sha, upsert:false, audio/mpeg; 409 "exists" → finish', async () => {
  fake.calls.length = 0;
  const song = siteMp3(44100, 2);
  const meta = Buffer.from(JSON.stringify({ client_key: crypto.randomUUID(), type: 'ring', origin: 'file', name: 'x' })).toString('base64url');
  const res = await handlers['library-upload'](new Request('https://f', { method: 'POST', headers: {
    authorization: 'Bearer h.ok.s', origin: 'https://staging.example', 'x-library-meta': meta }, body: song }));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://staging.example');
  const begin = fake.calls.find((c) => c[0] === 'rpc' && c[2].p_op === 'begin');
  assert.equal(begin[1], 'svc_library'); assert.equal(begin[2].p_args.size, song.byteLength);
  assert.equal(begin[2].p_args.user_id, '00000000-0000-0000-0000-0000000000a1');
  const up = fake.calls.find((c) => c[0] === 'upload');
  assert.equal(up[1], 'user-media'); assert.equal(up[4].upsert, false); assert.equal(up[4].contentType, 'audio/mpeg');
  assert.ok(fake.calls.some((c) => c[0] === 'rpc' && c[2].p_op === 'finish'));
});
test('W3 rejected session never reaches rpc or storage', async () => {
  fake.calls.length = 0;
  const meta = Buffer.from(JSON.stringify({ client_key: crypto.randomUUID(), type: 'ring', origin: 'file' })).toString('base64url');
  const res = await handlers['library-upload'](new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.bad.s', 'x-library-meta': meta }, body: 'x' }));
  assert.equal(res.status, 401); assert.equal(fake.calls.length, 0);
  // no metadata: refused from the headers alone (400), before Auth is even asked
  const res2 = await handlers['library-upload'](new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.bad.s' }, body: 'x' }));
  assert.equal(res2.status, 400); assert.equal(fake.calls.length, 0);
});
test('W4 download: signed URL lifetime fixed at 300 s by the server, with a download filename', async () => {
  const h = await load('library-download');
  fake.calls.length = 0;
  const res = await h(new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.ok.s' }, body: JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', expires_in: 999999 }) }));
  assert.equal(res.status, 200);
  const s = fake.calls.find((c) => c[0] === 'sign');
  assert.equal(s[3], 300); assert.equal(s[4].download, 'צלצול.mp3');
});
test('W5 janitor reads JANITOR_SECRET from env and removes through the Storage API', async () => {
  const h = await load('library-janitor');
  fake.calls.length = 0;
  assert.equal((await h(new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer nope' } }))).status, 401);
  const ok = await h(new Request('https://f', { method: 'POST', headers: { authorization: `Bearer ${'j'.repeat(40)}` } }));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(fake.calls.find((c) => c[0] === 'remove').slice(1), ['user-media', ['u/x.mp3']]);
  assert.ok(fake.calls.some((c) => c[0] === 'rpc' && c[2].p_op === 'prune_usage'));
  assert.ok(fake.calls.some((c) => c[0] === 'rpc' && c[2].p_op === 'janitor_release'));
});
test('W6 account-delete: svc_account(p_op,p_args) with the session user only, global sign-out, Auth admin delete', async () => {
  const h = await load('account-delete');
  fake.calls.length = 0;
  const bad = await h(new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.ok.s', origin: 'https://snipring.com' }, body: '{}' }));
  assert.equal(bad.status, 400);
  assert.equal(fake.calls.length, 0);                                       // nothing happens without the confirmation word
  const ok = await h(new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.ok.s', origin: 'https://snipring.com' },
    body: JSON.stringify({ confirm: 'delete-my-account', user_id: '00000000-0000-0000-0000-0000000000b2' }) }));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(await ok.json(), { status: 'deleted' });
  const req = fake.calls.find((c) => c[0] === 'rpc' && c[2].p_op === 'request');
  assert.equal(req[1], 'svc_account');
  assert.deepEqual(req[2].p_args, { user_id: '00000000-0000-0000-0000-0000000000a1' });   // from the session, not the body
  assert.deepEqual(fake.calls.find((c) => c[0] === 'signOut').slice(1), ['h.ok.s', 'global']);
  assert.deepEqual(fake.calls.find((c) => c[0] === 'deleteUser').slice(1), ['00000000-0000-0000-0000-0000000000a1']);
});
test('W7 library-health reads HEALTH_SECRET (not the janitor secret) and reports yes/no checks', async () => {
  const h = await load('library-health');
  assert.equal((await h(new Request('https://f', { method: 'POST', headers: { authorization: `Bearer ${'j'.repeat(40)}` } }))).status, 401);
  const ok = await h(new Request('https://f', { method: 'POST', headers: { authorization: `Bearer ${'k'.repeat(40)}` } }));
  assert.equal(ok.status, 200, await ok.clone().text());
  const b = await ok.json();
  assert.equal(b.ok, true); assert.deepEqual(b.failing, []);
  assert.ok(fake.calls.some((c) => c[0] === 'rpc' && c[1] === 'svc_account' && c[2].p_op === 'health'));
});
test('W8 janitor backs up to R2 with SigV4 (keys from env, EU endpoint, bucket in the path), secret never sent', async () => {
  r2seen.length = 0;
  const h = await load('library-janitor');
  const ok = await h(new Request('https://f', { method: 'POST', headers: { authorization: `Bearer ${'j'.repeat(40)}` } }));
  const rep = await ok.json();
  assert.equal(rep.backup, 'on'); assert.equal(rep.backed_up, 1);
  const put = r2seen.find((x) => x.method === 'PUT');
  assert.equal(put!.url, 'https://acct123.eu.r2.cloudflarestorage.com/snipring-media-backup/u/b.mp3');
  assert.match(put!.auth, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
  assert.equal(put!.body, 1234);
  assert.ok(!JSON.stringify(r2seen).includes('r2secretTEST'));
  assert.ok(r2seen.some((x) => x.method === 'DELETE' && x.url.endsWith('/snipring-media-backup/u/x.mp3')));   // purge removes the backup first
});
test('W9 janitor e-mails the owner through Resend when unhealthy (key only in the auth header, address from env)', async () => {
  r2seen.length = 0; (globalThis as any).__fake.healthBad = true;
  try {
    const h = await load('library-janitor');
    const rep = await (await h(new Request('https://f', { method: 'POST', headers: { authorization: `Bearer ${'j'.repeat(40)}` } }))).json();
    assert.equal(rep.alert, 'sent');
    const mail = r2seen.find((x) => x.url === 'https://api.resend.com/emails');
    assert.ok(mail, 'no Resend call');
    assert.equal(mail!.auth, 'Bearer re_TESTKEY');
    const body = JSON.parse(String(mail!.body));
    assert.deepEqual(body.to, ['owner@example.invalid']);
    assert.match(body.from, /noreply@mail\.snipring\.com/);
    assert.match(body.subject, /no_stuck_deletes/);
    assert.ok(!String(mail!.body).includes('re_TESTKEY'));
  } finally { (globalThis as any).__fake.healthBad = false; }
});

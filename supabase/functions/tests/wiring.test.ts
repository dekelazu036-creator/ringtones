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
  JANITOR_SECRET: 'j'.repeat(40) + '\n',                // pasted in the dashboard with a trailing newline
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
    if (a.p_op === 'drop_tombstones') return { data: 0, error: null };
    return { data: true, error: null };
  },
  upload: async () => ({ data: null, error: { statusCode: '409', message: 'The resource already exists' } }),
};

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
  const res = await handlers['library-upload'](new Request('https://f', { method: 'POST', headers: { authorization: 'Bearer h.bad.s' }, body: 'x' }));
  assert.equal(res.status, 401); assert.equal(fake.calls.length, 0);
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
  assert.ok(fake.calls.some((c) => c[0] === 'rpc' && c[2].p_op === 'janitor_release'));
});

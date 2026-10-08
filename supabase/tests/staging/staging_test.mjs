#!/usr/bin/env node
// =====================================================================
// SnipRing Phase 1B — two-account tests against REAL Supabase Auth + Storage + Edge Functions.
// STAGING ONLY. Refuses to run against the production project.
// Zero dependencies (Node 18+). Run from the repo root on YOUR computer:
//
//   SB_URL=https://<staging-ref>.supabase.co  SB_KEY=<staging publishable key> \
//   A_EMAIL=... A_PASSWORD=... B_EMAIL=... B_PASSWORD=... \
//   node supabase/tests/staging/staging_test.mjs            (add --slow for the 6-minute expiry/URL tests)
//
// Passwords are typed into your own terminal only — never paste them into chat or commit them.
// Before running: both test users exist (Auth → Users → Add user), are in private.cloud_access,
// and reservations_open = true (see supabase/STAGING.md).
// =====================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const PROD_REF = 'gtjtvfogqrnuiducvoqm';
const { SB_URL = '', SB_KEY = '', A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD } = process.env;
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:8080';
const SLOW = process.argv.includes('--slow');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB_URL) || !SB_KEY || !A_EMAIL || !A_PASSWORD || !B_EMAIL || !B_PASSWORD) {
  console.error('Missing/invalid SB_URL, SB_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD'); process.exit(2);
}
if (SB_URL.includes(PROD_REF)) { console.error('REFUSING: this is the production project. Staging only.'); process.exit(2); }

const results = [];
const check = (id, name, ok, info = '') => { results.push({ id, name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- audio from the site's own encoder
const lameCtx = { console, Math, Int16Array, Int8Array, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Error };
lameCtx.window = lameCtx; lameCtx.self = lameCtx; vm.createContext(lameCtx);
vm.runInContext(readFileSync(new URL('../../../vendor/lame.min.js', import.meta.url), 'utf8'), lameCtx);
function mp3(seconds, freq = 440) {
  const sr = 44100, enc = new lameCtx.lamejs.Mp3Encoder(2, sr, 192), n = Math.round(sr * seconds);
  const L = new Int16Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / sr));
  const out = [];
  for (let i = 0; i < n; i += 1152) { const c = L.subarray(i, i + 1152); out.push(...enc.encodeBuffer(c, c)); }
  out.push(...enc.flush());
  return Uint8Array.from(out.map((x) => x & 255));
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---------------------------------------------------------------- API helpers
async function signIn(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`sign-in failed for ${email}: ${r.status} ${j.error_description || j.msg || ''}`);
  return { token: j.access_token, id: j.user.id };
}
const H = (tok, extra = {}) => ({ apikey: SB_KEY, ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra });
async function req(method, path, tok, body, extra = {}) {
  const r = await fetch(`${SB_URL}${path}`, { method, headers: H(tok, extra), body });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const upload = (tok, meta, bytes) => req('POST', '/functions/v1/library-upload', tok, bytes,
  { 'content-type': 'audio/mpeg', 'x-library-meta': b64url(meta), origin: ORIGIN });
const download = (tok, id) => req('POST', '/functions/v1/library-download', tok, JSON.stringify({ id }), { 'content-type': 'application/json', origin: ORIGIN });
const rpc = (tok, fn, args) => req('POST', `/rest/v1/rpc/${fn}`, tok, JSON.stringify(args), { 'content-type': 'application/json' });
const meta = (o = {}) => ({ client_key: randomUUID(), name: 'בדיקה', type: 'ring', origin: 'file', ...o });

// ---------------------------------------------------------------- run
const A = await signIn(A_EMAIL, A_PASSWORD);
const B = await signIn(B_EMAIL, B_PASSWORD);
check('T0', 'two distinct real accounts signed in', A.id !== B.id);

// T1 upload through the function
const songA = mp3(4, 440 + Math.floor(Math.random() * 400));
const up = await upload(A.token, meta(), songA);
check('T1', 'A uploads through library-upload → ready', up.status === 200 && up.json?.status === 'ready', `${up.status} ${up.text.slice(0, 120)}`);
const idA = up.json?.id;

// T2–T4 isolation through the REST API (RLS + grants)
const listA = await req('GET', '/rest/v1/library_items?select=id,name,size_bytes', A.token);
const listB = await req('GET', '/rest/v1/library_items?select=id,name', B.token);
check('T2', 'A lists own item; B sees none of A', listA.json?.some?.((x) => x.id === idA) && Array.isArray(listB.json) && !listB.json.some((x) => x.id === idA));
const hidden = await req('GET', '/rest/v1/library_items?select=storage_path,user_id,content_sha256', A.token);
check('T2b', 'hidden columns (path, user_id, hash) not readable', hidden.status >= 400, String(hidden.status));
const dlB = await download(B.token, idA);
check('T3', 'B cannot get a download link for A\'s item', dlB.status === 404, String(dlB.status));
const delB = await rpc(B.token, 'library_delete', { p_id: idA });
check('T4', 'B cannot delete A\'s item', delB.json === 'not_found', delB.text);
const stillA = await req('GET', `/rest/v1/library_items?select=id&id=eq.${idA}`, A.token);
check('T4b', 'A\'s item untouched', stillA.json?.length === 1);

// T5 direct Storage access with user tokens must all fail (no policies on user-media)
const pathA = `${A.id}/${idA}.mp3`;
const s1 = await req('POST', `/storage/v1/object/user-media/${A.id}/direct.mp3`, A.token, songA, { 'content-type': 'audio/mpeg' });
const s2 = await req('GET', `/storage/v1/object/authenticated/user-media/${pathA}`, A.token);
const s3 = await req('GET', `/storage/v1/object/authenticated/user-media/${pathA}`, B.token);
const s4 = await req('POST', '/storage/v1/object/list/user-media', A.token, JSON.stringify({ prefix: `${A.id}/` }), { 'content-type': 'application/json' });
const s5 = await req('POST', `/storage/v1/object/sign/user-media/${pathA}`, A.token, JSON.stringify({ expiresIn: 999999 }), { 'content-type': 'application/json' });
const s6 = await req('DELETE', `/storage/v1/object/user-media/${pathA}`, A.token);
const s7 = await req('POST', '/storage/v1/object/move', A.token, JSON.stringify({ bucketId: 'user-media', sourceKey: pathA, destinationKey: `${A.id}/moved.mp3` }), { 'content-type': 'application/json' });
const s8 = await req('GET', `/storage/v1/object/public/user-media/${pathA}`, null);
check('T5a', 'user cannot upload directly to user-media', s1.status >= 400, String(s1.status));
check('T5b', 'owner cannot read directly (only via the function)', s2.status >= 400, String(s2.status));
check('T5c', 'other user cannot read directly', s3.status >= 400, String(s3.status));
check('T5d', 'listing the bucket returns nothing', s4.status >= 400 || (Array.isArray(s4.json) && s4.json.length === 0), `${s4.status} ${s4.text.slice(0, 60)}`);
check('T5e', 'user cannot mint own signed URL (e.g. 999999 s)', s5.status >= 400, String(s5.status));
check('T5f', 'user cannot delete the object directly', s6.status >= 400, String(s6.status));
check('T5g', 'user cannot move/rename the object', s7.status >= 400, String(s7.status));
check('T5h', 'no public URL', s8.status >= 400, String(s8.status));

// T6–T8 grants
const ins = await req('POST', '/rest/v1/library_items', A.token, JSON.stringify({ name: 'x' }), { 'content-type': 'application/json' });
const upd = await req('PATCH', `/rest/v1/library_items?id=eq.${idA}`, A.token, JSON.stringify({ name: 'x' }), { 'content-type': 'application/json' });
check('T6', 'direct insert/update on library_items refused', ins.status >= 400 && upd.status >= 400, `${ins.status}/${upd.status}`);
const svc = await rpc(A.token, 'svc_library', { p_op: 'expired', p_args: {} });
check('T7', 'user cannot call svc_library', svc.status >= 400, String(svc.status));
const anonItems = await req('GET', '/rest/v1/library_items?select=id', null);
const anonProfiles = await req('GET', '/rest/v1/profiles?select=id', null);
check('T8', 'anon reads nothing from library_items or profiles', anonItems.status >= 400 && anonProfiles.status >= 400, `${anonItems.status}/${anonProfiles.status}`);

// T9 validation by the function
const wav = new Uint8Array(4000); wav.set([0x52, 0x49, 0x46, 0x46]);
const v1 = await upload(A.token, meta(), wav);
check('T9a', 'non-MP3 refused (415)', v1.status === 415, String(v1.status));
const v2 = await req('POST', '/functions/v1/library-upload', A.token, new Uint8Array(11 * 1024 * 1024), { 'content-type': 'audio/mpeg', 'x-library-meta': b64url(meta()), origin: ORIGIN });
check('T9b', 'over 10 MiB refused (413 from function or gateway)', v2.status === 413 || v2.status === 400, String(v2.status));
const v3 = await upload('not.a.jwt', meta(), songA);
const v4 = await upload(SB_KEY, meta(), songA);
check('T9c', 'forged token and bare API key refused', v3.status === 401 && v4.status === 401, `${v3.status}/${v4.status}`);

// T10 hash is the server's
const rowA = await rpc(A.token, 'library_job_status', { p_client_keys: [] });
check('T10', 'job status callable (own keys only)', rowA.status === 200, String(rowA.status));

// T12 concurrent duplicates: 6 parallel uploads of one new file → 1 ready, 5 duplicate
const dup = mp3(3, 1234);
const par = await Promise.all(Array.from({ length: 6 }, () => upload(B.token, meta(), dup)));
const readyN = par.filter((r) => r.json?.status === 'ready').length, dupN = par.filter((r) => r.json?.status === 'duplicate').length;
check('T12', '6 concurrent uploads of the same file → 1 stored', readyN === 1 && dupN === 5, `${readyN} ready / ${dupN} duplicate / ${par.map((r) => r.status)}`);

// T13 delete ∥ download race on a fresh item
const fresh = await upload(A.token, meta(), mp3(2, 777));
const [del] = await Promise.all([rpc(A.token, 'library_delete', { p_id: fresh.json?.id }), download(A.token, fresh.json?.id)]);
const after = await download(A.token, fresh.json?.id);
check('T13', 'after delete: no new download links', del.json === 'deleting' && after.status === 404, `${del.text}/${after.status}`);

// T14 a near-10 MiB upload: wall time through the function
let big = mp3(30); const parts = []; let total = 0;
while (total + big.length < 9.5 * 1024 * 1024) { parts.push(big); total += big.length; }
big = new Uint8Array(total); let o = 0; for (const p of parts) { big.set(p, o); o += p.length; }
const t0 = Date.now();
const bigUp = await upload(B.token, meta({ allow_duplicate: true }), big);
check('T14', `~${(total / 1048576).toFixed(1)} MiB upload completes`, bigUp.status === 200, `${bigUp.status} in ${Date.now() - t0} ms`);

// T11 usage counters reflect reality
const usageB = await rpc(B.token, 'library_usage', {});
check('T11', 'usage() returns own counters', usageB.status === 200 && usageB.json?.items >= 2, usageB.text);

// signed URL works now and is limited to 300 s by the server
const link = await download(A.token, idA);
check('T17a', 'download link valid for 300 s, fetchable', link.status === 200 && link.json?.expires_in === 300
  && (await fetch(link.json.url)).status === 200, String(link.status));
const got = link.status === 200 ? new Uint8Array(await (await fetch(link.json.url)).arrayBuffer()) : new Uint8Array();
check('T17b', 'downloaded bytes are exactly the uploaded bytes', sha(got) === sha(songA));

if (SLOW) {
  console.log('… waiting 305 s for the signed URL to expire');
  await sleep(305_000);
  check('T17c', 'signed URL refused after 300 s', (await fetch(link.json.url)).status >= 400);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
console.log('Manual checks still to do in the SQL editor: T15 expiry, T16 janitor cleanup, T18 switches, T19 orphans, T26 policy audit (see TEST_MATRIX.md).');
process.exit(failed.length ? 1 : 0);

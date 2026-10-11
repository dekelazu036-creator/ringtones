#!/usr/bin/env node
// T30 on STAGING: a real account with real cloud media deletes itself through account-delete.
// DESTRUCTIVE for the given user: use a disposable test user (C), never A or B.
//   SB_URL=https://<staging>.supabase.co SB_KEY=sb_publishable_... C_EMAIL=... C_PASSWORD=... \
//   node supabase/tests/staging/delete_account_test.mjs
// Prints PASS/FAIL lines only; never prints tokens or passwords.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const PROD_REF = 'gtjtvfogqrnuiducvoqm';
const { SB_URL = '', SB_KEY = '', C_EMAIL = '', C_PASSWORD = '' } = process.env;
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:8080';
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB_URL) || !SB_KEY || !C_EMAIL || !C_PASSWORD) { console.error('Missing SB_URL, SB_KEY, C_EMAIL, C_PASSWORD'); process.exit(2); }
if (SB_URL.includes(PROD_REF)) { console.error('REFUSING: production project. Staging only.'); process.exit(2); }
if (/\+[ab]@/i.test(C_EMAIL)) { console.error('REFUSING: this test deletes the account. Use a disposable user, not A or B.'); process.exit(2); }

const results = [];
const check = (id, name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${info ? `  (${info})` : ''}`); };

const ctx = { console, Math, Int16Array, Int8Array, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Error };
ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../../../vendor/lame.min.js', import.meta.url), 'utf8'), ctx);
function mp3(seconds, freq) {
  const sr = 44100, enc = new ctx.lamejs.Mp3Encoder(2, sr, 128), n = Math.round(sr * seconds), L = new Int16Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / sr));
  const out = []; for (let i = 0; i < n; i += 1152) { const c = L.subarray(i, i + 1152); out.push(...enc.encodeBuffer(c, c)); }
  out.push(...enc.flush()); return Uint8Array.from(out.map((x) => x & 255));
}
async function call(path, tok, body, extra = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${SB_URL}${path}`, { method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { apikey: SB_KEY, ...(tok ? { authorization: `Bearer ${tok}` } : {}), origin: ORIGIN, ...extra }, body });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text: text.slice(0, 160), ms: Date.now() - t0 };
  } catch (e) { return { status: 0, json: null, text: String(e.message), ms: Date.now() - t0 }; }
}
async function signIn() {
  const r = await call('/auth/v1/token?grant_type=password', null, JSON.stringify({ email: C_EMAIL, password: C_PASSWORD }), { 'content-type': 'application/json' });
  return r.status === 200 ? { token: r.json.access_token, id: r.json.user.id } : { status: r.status };
}
const meta = () => Buffer.from(JSON.stringify({ client_key: randomUUID(), name: 'delete-test', type: 'ring', origin: 'file' })).toString('base64url');
const upload = (tok, bytes) => call('/functions/v1/library-upload', tok, bytes, { 'content-type': 'audio/mpeg', 'x-library-meta': meta() });
const del = (tok, body) => call('/functions/v1/account-delete', tok, JSON.stringify(body), { 'content-type': 'application/json' });

const C = await signIn();
check('D0', 'test user C signs in', !!C.token, C.token ? '' : `status ${C.status}`);
if (!C.token) process.exit(1);
console.log(`      user id ${C.id}`);

const u1 = await upload(C.token, mp3(3, 300 + Math.random() * 500));
const u2 = await upload(C.token, mp3(4, 300 + Math.random() * 500));
check('D1', 'C saves two sounds in the cloud', u1.json?.status === 'ready' && u2.json?.status === 'ready', `${u1.status}/${u2.status} ${u1.json?.error ?? ''}${u2.json?.error ?? ''}`);
const link = await call('/functions/v1/library-download', C.token, JSON.stringify({ id: u1.json?.id }), { 'content-type': 'application/json' });
check('D2', 'C gets a download link before deletion', link.status === 200 && !!link.json?.url, String(link.status));

const noWord = await del(C.token, {});
check('D3', 'account-delete without the confirmation word → 400, nothing happens', noWord.status === 400, String(noWord.status));
const stillIn = await call('/rest/v1/rpc/library_usage', C.token, '{}', { 'content-type': 'application/json' });
check('D3b', 'C still has the 2 sounds after the refused request', stillIn.json?.items === 2, JSON.stringify(stillIn.json));

const go = await del(C.token, { confirm: 'delete-my-account' });
check('D4', 'account-delete with confirmation → 200 deleted', go.status === 200 && go.json?.status === 'deleted', `${go.status} ${go.text} in ${go.ms} ms`);

const after = await fetch(link.json?.url ?? 'about:blank', { signal: AbortSignal.timeout(30_000) }).then((r) => r.status).catch(() => 0);
check('D5', 'the earlier download link no longer returns the file', after !== 200, String(after));
const again = await signIn();
check('D6', 'C can no longer sign in with the old password', !again.token, String(again.status));
const oldTok = await upload(C.token, mp3(2, 500));
check('D7', 'the old session token cannot upload', oldTok.status === 401 || oldTok.status === 403, `${oldTok.status} ${oldTok.json?.error ?? oldTok.text}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Minimal S3-compatible client for Cloudflare R2 (media backup). AWS Signature V4, path-style URLs,
// region "auto". Only what the janitor needs: PUT, DELETE, LIST (ListObjectsV2). No SDK, no dependencies.
// Runtime-neutral (Web Crypto + fetch), so the same code runs in Deno and in the local Node tests.

export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string };

const r2enc = new TextEncoder();
const r2hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
async function r2Sha256(data: Uint8Array | string): Promise<string> {
  return r2hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? r2enc.encode(data) : data));
}
async function r2Hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, r2enc.encode(msg));
}
// RFC 3986 encoding as S3 expects ('/' kept in paths)
const r2EncSeg = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const r2EncPath = (p: string) => p.split('/').map(r2EncSeg).join('/');

export type Signed = { url: string; headers: Record<string, string> };

/** Signs one request. `amzDate` is injectable for tests (yyyymmddThhmmssZ). */
export async function signV4(method: string, host: string, path: string, query: Record<string, string>, headers: Record<string, string>,
  payloadHash: string, cfg: { accessKeyId: string; secretAccessKey: string; region: string; service?: string }, amzDate: string): Promise<Signed> {
  const service = cfg.service ?? 's3', date = amzDate.slice(0, 8);
  const h: Record<string, string> = { ...headers, host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower: Record<string, string> = {}; for (const [k, v] of Object.entries(h)) lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const canonQuery = Object.keys(query).sort().map((k) => `${r2EncSeg(k)}=${r2EncSeg(query[k])}`).join('&');
  const canonical = [method, r2EncPath(path), canonQuery, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${cfg.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await r2Sha256(canonical)].join('\n');
  let k = await r2Hmac(r2enc.encode('AWS4' + cfg.secretAccessKey), date);
  for (const part of [cfg.region, service, 'aws4_request']) k = await r2Hmac(k, part);
  const sig = r2hex(await r2Hmac(k, toSign));
  const out: Record<string, string> = { ...h };
  delete out.host;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  return { url: `https://${host}${r2EncPath(path)}${canonQuery ? '?' + canonQuery : ''}`, headers: out };
}

const r2NowAmz = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function r2Client(cfg: R2Config, fetchFn: typeof fetch = fetch) {
  const host = new URL(cfg.endpoint).host;
  const sc = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region ?? 'auto' };
  const p = (key: string) => `/${cfg.bucket}/${key}`;
  return {
    async put(key: string, bytes: Uint8Array): Promise<'ok' | { error: string }> {
      const s = await signV4('PUT', host, p(key), {}, { 'content-type': 'audio/mpeg', 'content-length': String(bytes.byteLength) }, await r2Sha256(bytes), sc, r2NowAmz());
      const r = await fetchFn(s.url, { method: 'PUT', headers: s.headers, body: bytes });
      await r.arrayBuffer().catch(() => null);
      return r.ok ? 'ok' : { error: `r2 put ${r.status}` };
    },
    async del(key: string): Promise<'ok' | { error: string }> {
      const s = await signV4('DELETE', host, p(key), {}, {}, await r2Sha256(''), sc, r2NowAmz());
      const r = await fetchFn(s.url, { method: 'DELETE', headers: s.headers });
      await r.arrayBuffer().catch(() => null);
      return r.ok || r.status === 404 ? 'ok' : { error: `r2 delete ${r.status}` };     // already gone = fine
    },
    /** One page of keys (≤ 1000) with their last-modified time. */
    async list(token?: string): Promise<{ keys: { key: string; modified: number }[]; next?: string } | { error: string }> {
      const q: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
      if (token) q['continuation-token'] = token;
      const s = await signV4('GET', host, `/${cfg.bucket}`, q, {}, await r2Sha256(''), sc, r2NowAmz());
      const r = await fetchFn(s.url, { method: 'GET', headers: s.headers });
      const xml = await r.text();
      if (!r.ok) return { error: `r2 list ${r.status}` };
      const keys = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
        key: (/<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? '').replace(/&amp;/g, '&'),
        modified: Date.parse(/<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1])?.[1] ?? '') || 0,
      })).filter((k) => k.key);
      const next = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
      return { keys, next };
    },
  };
}

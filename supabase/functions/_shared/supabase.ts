// Real dependencies for the Edge runtime (Deno). Not imported by the local Node tests.
// Secrets come from the environment Supabase injects into every function; nothing is hard-coded.
import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import type { Config, Deps } from './library.ts';

const BUCKET = 'user-media';

function secretKey(): string {
  // New API keys: SUPABASE_SECRET_KEYS is a JSON dictionary ({"default": "sb_secret_..."}).
  // Legacy projects: SUPABASE_SERVICE_ROLE_KEY.
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const k = JSON.parse(dict)?.default;
      if (typeof k === 'string' && k) return k;
    } catch { /* fall back */ }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('no secret key in the function environment');
}

export function createDeps(fn: string): Deps {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL missing');
  const admin = createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const storage = () => admin.storage.from(BUCKET);

  return {
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);          // asks Supabase Auth; rejects expired/forged/revoked
      if (error || !data?.user) return null;
      return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
    },
    async rpc(op, args) {
      const { data, error } = await admin.rpc('svc_library', { p_op: op, p_args: args });
      if (error) throw new Error(`svc_library ${op}: ${error.code ?? ''} ${error.message}`);
      return data;
    },
    async upload(path, bytes) {
      const { error } = await storage().upload(path, bytes, {
        contentType: 'audio/mpeg', upsert: false, cacheControl: '3600',
      });
      if (!error) return 'ok';
      const status = String((error as { statusCode?: string | number }).statusCode ?? (error as { status?: number }).status ?? '');
      if (status === '409' || /already exists|duplicate/i.test(error.message)) return 'exists';
      return { error: `${status} ${error.message}`.trim() };
    },
    async signedUrl(path, seconds, downloadName) {
      const { data, error } = await storage().createSignedUrl(path, seconds, { download: downloadName });
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
    async remove(paths) {
      const { data, error } = await storage().remove(paths);
      if (error) return { error: error.message };
      return { removed: (data ?? []).map((o: { name: string }) => o.name) };
    },
    log(event) {
      console.log(JSON.stringify({ fn, at: new Date().toISOString(), ...event }));
    },
  };
}

export function configFromEnv(): Config {
  const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://snipring.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    allowedOrigins: origins,
    maxFileBytes: 10 * 1024 * 1024,
    signedUrlSeconds: 300,
    janitorSecret: (Deno.env.get('JANITOR_SECRET') ?? '').trim(),   // dashboard pastes often end in a newline
    janitorBudgetMs: 100_000,
    holder: Deno.env.get('SB_EXECUTION_ID') ?? undefined,
  };
}

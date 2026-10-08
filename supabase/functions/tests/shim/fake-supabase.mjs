// Records how the Edge code drives supabase-js. Behaviour is scripted per test via globalThis.__fake.
export function createClient(url, key, opts) {
  const f = globalThis.__fake;
  f.created.push({ url, key, opts });
  return {
    auth: { getUser: async (t) => f.getUser(t) },
    rpc: async (fn, args) => { f.calls.push(['rpc', fn, args]); return f.rpc(fn, args); },
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes, o) => { f.calls.push(['upload', bucket, path, bytes.byteLength, o]); return f.upload(path); },
        createSignedUrl: async (path, secs, o) => { f.calls.push(['sign', bucket, path, secs, o]); return { data: { signedUrl: 'https://signed/' + path }, error: null }; },
        remove: async (paths) => { f.calls.push(['remove', bucket, paths]); return { data: paths.map((name) => ({ name })), error: null }; },
      }),
    },
  };
}

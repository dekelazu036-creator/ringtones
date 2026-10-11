export async function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:@supabase/supabase-js@')) {
    return { url: new URL('./fake-supabase.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}

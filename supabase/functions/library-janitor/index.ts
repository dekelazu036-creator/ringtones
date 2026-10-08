// library-janitor — see supabase/functions/_shared/library.ts for the logic and its rules.
import { handleJanitor } from '../_shared/library.ts';
import { configFromEnv, createDeps } from '../_shared/supabase.ts';

const deps = createDeps('library-janitor');
const cfg = configFromEnv();

Deno.serve((req: Request) => handleJanitor(req, deps, cfg));

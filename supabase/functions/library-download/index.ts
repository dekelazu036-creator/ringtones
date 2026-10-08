// library-download — see supabase/functions/_shared/library.ts for the logic and its rules.
import { handleDownload } from '../_shared/library.ts';
import { configFromEnv, createDeps } from '../_shared/supabase.ts';

const deps = createDeps('library-download');
const cfg = configFromEnv();

Deno.serve((req: Request) => handleDownload(req, deps, cfg));

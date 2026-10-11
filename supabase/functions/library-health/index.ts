// library-health — yes/no health checks for alerting; see supabase/functions/_shared/library.ts (handleHealth).
import { handleHealth } from '../_shared/library.ts';
import { configFromEnv, createDeps } from '../_shared/supabase.ts';

const deps = createDeps('library-health');
const cfg = configFromEnv();

Deno.serve((req: Request) => handleHealth(req, deps, cfg));

// account-delete — see supabase/functions/_shared/library.ts (handleAccountDelete) and supabase/account_delete.sql.
import { handleAccountDelete } from '../_shared/library.ts';
import { configFromEnv, createDeps } from '../_shared/supabase.ts';

const deps = createDeps('account-delete');
const cfg = configFromEnv();

Deno.serve((req: Request) => handleAccountDelete(req, deps, cfg));

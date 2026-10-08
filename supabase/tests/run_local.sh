#!/usr/bin/env bash
# Builds a throw-away local database and runs SnipRing's SQL test suites.
# LOCAL ONLY: uses the stub in stub_supabase.sql, never a Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-snipring_test}
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null
sudo -u postgres createdb "$DB"
export PGUSER=postgres
run() { sudo -u postgres $PSQL "$@"; }
run -f tests/stub_supabase.sql >/dev/null
run -f schema.sql >/dev/null
run -f auth_1a.sql >/dev/null
[ "${1:-}" = "--base-only" ] && exit 0
run -f library_1b.sql >/dev/null
echo "migration applied"
# re-running the migration must be safe (idempotent)
run -f library_1b.sql >/dev/null
echo "migration re-applied (idempotent)"
run -f tests/library_1b_test.sql

# teardown must refuse while media rows/objects exist ...
if run -f library_1b_teardown.sql >/dev/null 2>&1; then echo "FAIL teardown ran with data present"; exit 1; fi
echo "PASS teardown refused while library data exists"
# ... and must work (then allow a clean re-install) on an empty library
sudo -u postgres dropdb "$DB" && sudo -u postgres createdb "$DB"
run -f tests/stub_supabase.sql >/dev/null; run -f schema.sql >/dev/null; run -f auth_1a.sql >/dev/null; run -f library_1b.sql >/dev/null
run -f library_1b_teardown.sql >/dev/null
[ "$(sudo -u postgres psql -X -At -d "$DB" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' or p.proname like 'library_%' or p.proname='svc_library'")" = 0 ] \
  && echo "PASS teardown removed every Phase 1B function" || { echo "FAIL teardown left functions"; exit 1; }
[ "$(sudo -u postgres psql -X -At -d "$DB" -c "select to_regclass('public.profiles') is not null and exists (select 1 from pg_policies where tablename='profiles' and policyname='own profile readable')")" = t ] \
  && echo "PASS profiles (1A) untouched by teardown" || { echo "FAIL profiles changed"; exit 1; }
run -f library_1b.sql >/dev/null && echo "PASS re-install after teardown"

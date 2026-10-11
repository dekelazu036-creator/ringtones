#!/bin/zsh
# PRODUCTION rollout, step 2 (docs/PRODUCTION_ROLLOUT.md): database objects. OWNER RUNS THIS.
# Runs the idempotent SQL files in order against production through the Supabase CLI (Management API),
# without changing the CLI link (which stays on staging). Stops at the first error.
# Output of the read-only policy audit is saved to supabase/.temp/prod_audit.txt (git-ignored) for review.
set -u
PROD=gtjtvfogqrnuiducvoqm
cd "$(dirname "$0")/../.." || exit 1
LOG=supabase/.temp/prod_sql.log; : > "$LOG"

echo "This changes the PRODUCTION database ($PROD): schema.sql, auth_1a.sql, library_1b.sql, account_delete.sql."
echo "Uploads stay CLOSED afterwards; nothing changes for visitors. Rollback: supabase/library_1b_teardown.sql."
read -r "OK?Type the word production to continue: "
[[ "$OK" == "production" ]] || { echo "Cancelled. Nothing was run."; exit 1; }

run() {
  echo "== $1"
  out=$(supabase db query --project-ref "$PROD" -f "$1" 2>&1); code=$?
  print -r -- "== $1 (exit $code)"$'\n'"$out" >> "$LOG"
  if (( code != 0 )) || print -r -- "$out" | grep -qiE '"error"|ERROR:'; then
    echo "FAILED on $1. Nothing after it was run. Details: $LOG"; exit 1
  fi
  print -r -- "$out" | grep -oE '"status": "[^"]*"' | tail -1
}
run supabase/schema.sql
run supabase/auth_1a.sql
run supabase/library_1b.sql
run supabase/account_delete.sql

echo "== policy audit (read-only)"
supabase db query --project-ref "$PROD" -o csv -f supabase/tests/policy_audit.sql > supabase/.temp/prod_audit.txt 2>&1
echo "Saved to supabase/.temp/prod_audit.txt"
echo "DONE. Tell Claude: step 2 done."

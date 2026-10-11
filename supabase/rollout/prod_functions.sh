#!/bin/zsh
# PRODUCTION rollout, steps 3 + 4 (docs/PRODUCTION_ROLLOUT.md): Edge Functions, secrets, janitor schedule.
# OWNER RUNS THIS after prod_sql.sh. The CLI link stays on staging; every command names the production ref.
# A new random JANITOR_SECRET is generated here, stored as a function secret AND in Vault,
# and never printed or written to the repo (a temp file with mode 600 is removed at once).
set -u
PROD=gtjtvfogqrnuiducvoqm
cd "$(dirname "$0")/../.." || exit 1

echo "This deploys 4 Edge Functions to PRODUCTION ($PROD), sets ALLOWED_ORIGINS and a new JANITOR_SECRET,"
echo "enables pg_cron + pg_net, creates 2 Vault secrets and schedules the janitor every 10 minutes."
read -r "OK?Type the word production to continue: "
[[ "$OK" == "production" ]] || { echo "Cancelled. Nothing was run."; exit 1; }

fail() { echo "FAILED: $1"; exit 1; }

echo "== function secrets"
SECRET=$(openssl rand -hex 32) || fail "openssl"
TMP=$(mktemp); chmod 600 "$TMP"
print -r -- "ALLOWED_ORIGINS=https://snipring.com,https://www.snipring.com" > "$TMP"
print -r -- "JANITOR_SECRET=$SECRET" >> "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
rm -f "$TMP"
(( code == 0 )) || { unset SECRET; fail "supabase secrets set"; }

echo "== deploy functions"
for f in library-upload library-download account-delete; do
  supabase functions deploy "$f" --project-ref "$PROD" --use-api >/dev/null 2>&1 || { unset SECRET; fail "deploy $f"; }
  echo "   $f ok"
done
supabase functions deploy library-janitor --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || { unset SECRET; fail "deploy library-janitor"; }
echo "   library-janitor ok (verify_jwt off: it checks its own secret)"

echo "== extensions + Vault secrets"
SQLF=$(mktemp); chmod 600 "$SQLF"
cat > "$SQLF" <<SQL
create extension if not exists pg_cron;
create extension if not exists pg_net;
do \$\$ begin
  -- re-runnable: update the secret if it exists, create it otherwise
  if exists (select 1 from vault.secrets where name = 'library_project_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'library_project_url'), 'https://$PROD.supabase.co');
  else perform vault.create_secret('https://$PROD.supabase.co', 'library_project_url'); end if;
  if exists (select 1 from vault.secrets where name = 'library_janitor_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'library_janitor_secret'), '$SECRET');
  else perform vault.create_secret('$SECRET', 'library_janitor_secret'); end if;
end \$\$;
select 'vault ready' as status;
SQL
out=$(supabase db query --project-ref "$PROD" -f "$SQLF" 2>&1); code=$?
rm -f "$SQLF"; unset SECRET
(( code == 0 )) && ! print -r -- "$out" | grep -qiE '"error"|ERROR:' || fail "vault/extensions: $(print -r -- "$out" | grep -iE 'error' | head -1)"
echo "   ok"

echo "== schedule"
out=$(supabase db query --project-ref "$PROD" -f supabase/library_1b_cron.sql 2>&1)
print -r -- "$out" | grep -q "scheduled every 10 minutes" || fail "cron: $(print -r -- "$out" | grep -iE 'error' | head -1)"
echo "   janitor scheduled every 10 minutes"

echo "== check"
supabase functions list --project-ref "$PROD" 2>/dev/null | grep -E "library|account" | awk '{print "   "$0}'
echo "DONE. Tell Claude: step 3 done. The first janitor run is at the next 10-minute mark."

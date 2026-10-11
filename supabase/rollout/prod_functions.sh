#!/bin/zsh
# PRODUCTION rollout, step 3 (docs/PRODUCTION_ROLLOUT.md): Edge Functions + function secrets. OWNER RUNS THIS.
# The CLI link stays on staging; every command names the production ref (functions deploy and secrets set
# support --project-ref; `db query` does not, so the SQL part goes through the SQL Editor).
# A new random JANITOR_SECRET is set as a function secret and, for step 4, put on the CLIPBOARD as a ready
# SQL snippet for Vault. It is never printed and never written to the repo.
set -u
PROD=gtjtvfogqrnuiducvoqm
cd "$(dirname "$0")/../.." || exit 1

echo "This deploys 4 Edge Functions to PRODUCTION ($PROD) and sets ALLOWED_ORIGINS + a new JANITOR_SECRET."
read -r "OK?Type the word production to continue: "
[[ "$OK" == "production" ]] || { echo "Cancelled. Nothing was run."; exit 1; }
fail() { echo "FAILED: $1"; unset SECRET; exit 1; }

echo "== function secrets"
SECRET=$(openssl rand -hex 32) || fail "openssl"
TMP=$(mktemp); chmod 600 "$TMP"
print -r -- "ALLOWED_ORIGINS=https://snipring.com,https://www.snipring.com" > "$TMP"
print -r -- "JANITOR_SECRET=$SECRET" >> "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
rm -f "$TMP"
(( code == 0 )) || fail "supabase secrets set"
echo "   ok"

echo "== deploy functions"
for f in library-upload library-download account-delete; do
  supabase functions deploy "$f" --project-ref "$PROD" --use-api >/dev/null 2>&1 || fail "deploy $f"
  echo "   $f ok"
done
supabase functions deploy library-janitor --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || fail "deploy library-janitor"
echo "   library-janitor ok (verify_jwt off: it checks its own secret)"

# step 4 snippet: Vault entries with the SAME secret, re-runnable; goes to the clipboard only
pbcopy <<SQL
-- SnipRing step 4a: Vault secrets for the janitor schedule (contains a secret: do not save this query)
do \$\$ begin
  if exists (select 1 from vault.secrets where name = 'library_project_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'library_project_url'), 'https://$PROD.supabase.co');
  else perform vault.create_secret('https://$PROD.supabase.co', 'library_project_url'); end if;
  if exists (select 1 from vault.secrets where name = 'library_janitor_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'library_janitor_secret'), '$SECRET');
  else perform vault.create_secret('$SECRET', 'library_janitor_secret'); end if;
end \$\$;
select 'vault ready' as status;
SQL
unset SECRET

echo "== check"
supabase functions list --project-ref "$PROD" 2>/dev/null | grep -E "library|account" | awk '{print "   "$0}'
echo "DONE. The Vault SQL for step 4 is on your clipboard (paste it in the SQL Editor next). Tell Claude: step 3 done."

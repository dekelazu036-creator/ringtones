#!/bin/zsh
# PRODUCTION: (re)create the janitor secret. OWNER RUNS THIS.
# Generates a new random JANITOR_SECRET, sets it as the production function secret, and puts the matching
# Vault SQL on the clipboard for the SQL Editor. The secret is never printed or written to disk.
set -u
PROD=gtjtvfogqrnuiducvoqm
echo "This sets a NEW JANITOR_SECRET on PRODUCTION ($PROD) and copies the matching Vault SQL to your clipboard."
read -r "OK?Type the word production to continue: "
[[ "$OK" == "production" ]] || { echo "Cancelled."; exit 1; }
SECRET=$(openssl rand -hex 32) || exit 1
TMP=$(mktemp); chmod 600 "$TMP"; print -r -- "JANITOR_SECRET=$SECRET" > "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
rm -f "$TMP"
(( code == 0 )) || { unset SECRET; echo "FAILED: supabase secrets set"; exit 1; }
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
echo "DONE. The function secret is set and the Vault SQL is on your clipboard: paste it in the SQL Editor NOW."

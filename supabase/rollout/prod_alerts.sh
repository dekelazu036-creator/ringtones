#!/bin/zsh
# PRODUCTION owner alerts by e-mail (janitor step 10). OWNER RUNS THIS.
# Asks for a Resend API key (hidden; create one in Resend with "Sending access" for mail.snipring.com only)
# and the address that should receive alerts, stores both as production function secrets, redeploys the janitor.
set -u
PROD=gtjtvfogqrnuiducvoqm
cd "$(dirname "$0")/../.." || exit 1
echo "Alert e-mails for PRODUCTION ($PROD)."
read -r "TO?Send alerts to (e-mail address): "
[[ "$TO" =~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' ]] || { echo "Not an e-mail address."; exit 1; }
read -rs "KEY?Resend API key (hidden): "; echo
[[ "$KEY" == re_* ]] || { echo "A Resend API key starts with re_."; unset KEY; exit 1; }
TMP=$(mktemp); chmod 600 "$TMP"; { print -r -- "RESEND_API_KEY=$KEY"; print -r -- "ALERT_EMAIL=$TO"; } > "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
rm -f "$TMP"; unset KEY
(( code == 0 )) || { echo "FAILED: supabase secrets set"; exit 1; }
echo "   secrets set"
supabase functions deploy library-janitor --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || { echo "FAILED: deploy"; exit 1; }
echo "   library-janitor redeployed"
echo "DONE. Tell Claude: alerts done."

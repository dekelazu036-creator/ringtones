#!/bin/zsh
# PRODUCTION owner alerts by e-mail (janitor step 10). OWNER RUNS THIS.
# Asks for a Resend API key (hidden; create one in Resend with "Sending access" for mail.snipring.com only)
# and the address that should receive alerts, stores both as production function secrets, redeploys the janitor.
# The key never appears on screen, in shell history, in a process list (no argv) or in a file that survives:
# the only copy on disk is a mode-600 temp file, removed by the cleanup below on success, failure, Ctrl+C,
# terminal close (HUP) or kill (TERM).
set -u
PROD=gtjtvfogqrnuiducvoqm
cd "$(dirname "$0")/../.." || exit 1

TMP=''
cleanup() {
  [[ -n "$TMP" && -e "$TMP" ]] && rm -f -- "$TMP"
  TMP=''; unset KEY 2>/dev/null
}
trap cleanup EXIT                                   # normal end and every `exit`
trap 'cleanup; exit 130' INT                        # Ctrl+C
trap 'cleanup; exit 129' HUP                        # terminal closed
trap 'cleanup; exit 143' TERM                       # kill
umask 077                                           # anything created from here on is owner-only

echo "Alert e-mails for PRODUCTION ($PROD)."
read -r "TO?Send alerts to (e-mail address): "
[[ "$TO" =~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' ]] || { echo "Not an e-mail address."; exit 1; }
read -rs "KEY?Resend API key (hidden): "; echo
[[ "$KEY" == re_* ]] || { echo "A Resend API key starts with re_."; exit 1; }

TMP=$(mktemp "${TMPDIR:-/tmp}/snipring-alerts.XXXXXX") || { echo "FAILED: temp file"; exit 1; }
chmod 600 "$TMP"
{ print -r -- "RESEND_API_KEY=$KEY"; print -r -- "ALERT_EMAIL=$TO"; } > "$TMP"
unset KEY
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
cleanup                                             # the key file is gone before anything else happens
(( code == 0 )) || { echo "FAILED: supabase secrets set"; exit 1; }
echo "   secrets set"
supabase functions deploy library-janitor --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || { echo "FAILED: deploy"; exit 1; }
echo "   library-janitor redeployed"
echo "DONE. Tell Claude: alerts done."

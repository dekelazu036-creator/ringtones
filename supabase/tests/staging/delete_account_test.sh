#!/bin/zsh
# Runs T30 (account deletion) on STAGING for a disposable test user. The password is typed hidden.
cd "$(dirname "$0")/../../.." || exit 1
export SB_URL=https://kavomvsvufqnqjepbevs.supabase.co
export SB_KEY=sb_publishable_uxiKAioDg-X970ACgBxBjw_4y1iemPc
echo "Account deletion test (staging). This DELETES the test user you name. Use C, never A or B."
read -r "C_EMAIL?Test user email: "
read -rs "C_PASSWORD?Password (hidden): "; echo
export C_EMAIL C_PASSWORD
node supabase/tests/staging/delete_account_test.mjs 2>&1 | tee supabase/.temp/t30.log
unset C_PASSWORD

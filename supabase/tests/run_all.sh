#!/usr/bin/env bash
# Runs every LOCAL Phase 1B check. Needs: Postgres 16 (local, scratch), Node 22+, ffmpeg.
# Touches no Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== SQL: migration, security, behaviour, teardown";   tests/run_local.sh | grep -E "PASS|FAIL|^ +[0-9]+ +\| +[0-9]+ *$|migration" | grep -v "| PASS"
echo "== SQL: concurrency";                                 tests/library_1b_concurrency.sh | tail -1
cd functions
echo "== Functions: MP3 check";                             node --test tests/mp3.test.ts 2>&1 | grep -E "^# (pass|fail)"
echo "== Functions: logic against the real SQL";            node --test tests/library.test.ts 2>&1 | grep -E "^# (pass|fail)"
echo "== Functions: Deno entry-point wiring";               node --import ./tests/shim/register.mjs --test tests/wiring.test.ts 2>&1 | grep -E "^# (pass|fail)"
echo "== Functions: single-file bundles (dist)";          TARGET=dist node --import ./tests/shim/register.mjs --test tests/wiring.test.ts 2>&1 | grep -E "^# (pass|fail)"

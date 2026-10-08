# Phase 1B database & storage test matrix

Status: **L** = passed locally (stub), **S** = staging. First staging run 2026-10-08: T0–T9a, T9c, T10, T12, T13, T17a–b passed; T9b failed (hung → 503, fixed by draining unread bodies, rerun pending); T11/T14 failed on a runner bug (fixed). T26 audit ran (see CLAUDE.md M1).

| Invariant | Local tests | Staging (real Auth/Storage) |
|---|---|---|
| Cross-user isolation | P*, R1–R8, F9, I11–I12, C* | T2–T4, T3 |
| Storage authorization (no browser access) | S10–S11, P5, P12, P14 | T5a–T5h |
| Role boundaries / SECURITY DEFINER | S1–S9, P1–P17 | T6–T8, T26 |
| JWT validation | I2, W3 | T9c |
| Signed URL authorization & lifetime | R8, I11, W4 | T3, T17a–c |
| MP3 / size / hash measured by server | M1–M14, I4–I7, F7, I9 | T9a–b, T14 |
| Refusals answer promptly (unread body drained) | I4b | T9b, T9d (bodies > 20 MiB: cancelled after 20 MiB, not covered on staging) |
| Concurrent uploads & duplicates | F13, C1, C2, I8 | T12 |
| Quota enforcement (items, bytes, physical, project, rate) | Q1–Q8, C2–C3 | T11 |
| Expired reservations | E1–E5, I16 | T15 (manual) |
| Failed uploads / lost responses | F8, F15–F17, I9–I10 | — |
| Reliable deletion | D1–D19, C4, C6, I16 | T13, T16 (manual) |
| Orphan cleanup | O1–O2, I16 | T19 (manual) |
| Emergency stop / reservations switch | W1–W8, I14 | T18 (manual) |
| Account switching (server side) | F9, I12 | T2–T4 |
| Counters == rows | Z1, C-Z, I18, O3–O4 | T16 |
| Rollback | teardown ×4 | — (not on staging unless decided) |

## Manual staging checks (SQL editor, staging project)
- **T15 expiry**: start an upload in the browser test and kill the network before it finishes, or
  `update public.library_items set expires_at = now() - interval '1 minute' where state = 'uploading';`
  → within 10 min the row is `abandoned`, then `purged` after the grace period; the object is gone.
- **T16 janitor**: delete an item, wait ≤ 20 min → `state = 'purged'`, object absent in Storage,
  `select * from private.library_health;` shows zero stuck items and a recent `last_janitor_run`.
- **T18 switches**: set `reservations_open = false` → new uploads 503 `reservations_closed`;
  `emergency_stop = true` → uploads 503 `stopped`, downloads and deletes still work. Reset both.
- **T19 orphans**: upload any small MP3 via the dashboard into `user-media/<uuid A>/orphan.mp3`;
  after > 1 h the janitor removes it and logs `orphan_removed`.
- **T26 audit**: run `supabase/tests/policy_audit.sql`; output must match the expected list.

## Not covered yet (client side, later milestones)
Local queue ownership, sign-out with last copy (D8), originals vs `cloudCopy` (D11), blocked
`deleteDatabase`, local storage shortage, AbortController on account switch — they belong to the
library page and queue, which are not part of M0.

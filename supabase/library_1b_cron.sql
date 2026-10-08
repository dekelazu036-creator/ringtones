-- =====================================================================
-- SnipRing Phase 1B: schedule library-janitor every 10 minutes.  NOT RUN.
-- Run only AFTER library_1b.sql and AFTER library-janitor is deployed with JANITOR_SECRET set.
--
-- Secrets are NOT in this file. Before running it, the owner creates two Vault entries
-- in the SQL editor (values typed there, never committed or pasted in chat):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'library_project_url');
--   select vault.create_secret('<the same random value as the JANITOR_SECRET function secret>', 'library_janitor_secret');
-- Requires extensions pg_cron and pg_net (Database → Extensions; both are on the Free plan).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if (select count(*) from vault.decrypted_secrets
       where name in ('library_project_url', 'library_janitor_secret')) <> 2 then
    raise exception 'create the two Vault secrets first (see header)';
  end if;
  if exists (select 1 from cron.job where jobname = 'library-janitor') then
    perform cron.unschedule('library-janitor');
  end if;
end $$;

select cron.schedule('library-janitor', '*/10 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'library_project_url')
               || '/functions/v1/library-janitor',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'library_janitor_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

select 'library-janitor scheduled every 10 minutes' as status;

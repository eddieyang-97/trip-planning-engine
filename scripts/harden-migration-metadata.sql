-- Apply only after explicit approval for the intended deployment.
-- Matches migration bootstrap protection; does not change version rows or trip data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
alter table public.app_schema_migrations enable row level security;
revoke all on table public.app_schema_migrations from public, anon, authenticated;
revoke all (version) on table public.app_schema_migrations from public, anon, authenticated;
commit;

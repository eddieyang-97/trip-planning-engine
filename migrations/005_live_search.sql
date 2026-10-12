alter table search_runs drop constraint search_runs_provider_check;
alter table search_runs add constraint search_runs_provider_check check(provider in ('fixture','serpapi'));
alter table observations drop constraint observations_provenance_check;
alter table observations add constraint observations_provenance_check check(provenance in ('synthetic','user_reported','provider_reported'));
alter table search_runs add column requested_by uuid;
alter table search_runs add column client_id text;
alter table search_runs add column grant_version text;
alter table search_runs add column reserved_requests integer not null default 0 check(reserved_requests between 0 and 3);
create index live_search_admission on search_runs(provider,created_at,requested_by);
create table provider_attempts (
  run_id uuid not null references search_runs(id), attempt integer not null check(attempt between 1 and 3),
  stage text not null check(stage in ('outbound','return','booking')),
  status text not null check(status in ('reserved','success','failed','outcome_unknown')),
  reserved_at timestamptz not null default now(), finished_at timestamptz,
  diagnostic jsonb, primary key(run_id,attempt)
);
alter table provider_attempts enable row level security;
revoke all on provider_attempts from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on provider_attempts from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on provider_attempts from authenticated; end if;
end $$;

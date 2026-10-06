create table client_grants (
  owner_id uuid not null, client_id text not null,
  permissions text[] not null, revoked_at timestamptz,
  primary key(owner_id, client_id)
);
create table trips (
  id uuid primary key, owner_id uuid not null, payload jsonb not null,
  created_at timestamptz not null default now()
);
create index trips_owner on trips(owner_id);
create table decisions (
  id uuid primary key, trip_id uuid not null references trips(id),
  title text not null, revision integer not null default 1,
  unique(id, trip_id)
);
create index decisions_trip on decisions(trip_id);
create table criteria_versions (
  decision_id uuid not null references decisions(id), version integer not null,
  payload jsonb not null, primary key(decision_id, version)
);
create table candidates (
  id uuid primary key, decision_id uuid not null references decisions(id),
  identity_key text not null, disposition text not null default 'neutral'
    check(disposition in ('neutral','saved','rejected')),
  unique(decision_id, identity_key), unique(id, decision_id)
);
create table search_runs (
  id uuid primary key, decision_id uuid not null references decisions(id),
  criteria_version integer not null, provider text not null check(provider = 'fixture'),
  status text not null check(status in ('queued','running','complete','failed','outcome_unknown')),
  created_at timestamptz not null default now(), finished_at timestamptz,
  lease_until timestamptz, generation integer not null default 0,
  error_code text, coverage jsonb not null default '{}',
  unique(id, decision_id),
  foreign key(decision_id, criteria_version) references criteria_versions(decision_id, version)
);
create table observations (
  id uuid primary key, decision_id uuid not null, candidate_id uuid not null, run_id uuid,
  provenance text not null check(provenance in ('synthetic','user_reported')),
  payload jsonb not null, created_at timestamptz not null default now(),
  unique(id, decision_id),
  foreign key(candidate_id, decision_id) references candidates(id, decision_id),
  foreign key(run_id, decision_id) references search_runs(id, decision_id)
);
create index observations_run on observations(run_id);
create index observations_candidate on observations(candidate_id);
create table selections (
  id uuid primary key, decision_id uuid not null, observation_id uuid not null,
  criteria_version integer not null, rationale text not null, evaluation jsonb not null,
  created_at timestamptz not null default now(), superseded_at timestamptz,
  unique(id, decision_id),
  foreign key(observation_id, decision_id) references observations(id, decision_id),
  foreign key(decision_id, criteria_version) references criteria_versions(decision_id, version)
);
create unique index current_selection on selections(decision_id) where superseded_at is null;
create table booking_records (
  id uuid primary key, selection_id uuid not null references selections(id),
  booked_at timestamptz not null, note text not null,
  status text not null check(status = 'user_reported_booked')
);
create table mutation_requests (
  owner_id uuid not null, operation text not null, key text not null,
  request_hash text not null, response jsonb,
  primary key(owner_id, operation, key)
);
-- The service is the only data entry point. No direct browser or Supabase Data API access.
-- A database owner connection bypasses RLS: core ownership/grant checks are mandatory.
alter table client_grants enable row level security;
alter table trips enable row level security;
alter table decisions enable row level security;
alter table criteria_versions enable row level security;
alter table candidates enable row level security;
alter table search_runs enable row level security;
alter table observations enable row level security;
alter table selections enable row level security;
alter table booking_records enable row level security;
alter table mutation_requests enable row level security;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on client_grants,trips,decisions,criteria_versions,candidates,search_runs,
      observations,selections,booking_records,mutation_requests from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on client_grants,trips,decisions,criteria_versions,candidates,search_runs,
      observations,selections,booking_records,mutation_requests from authenticated;
  end if;
end $$;

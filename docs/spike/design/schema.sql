-- DESIGN DDL ONLY: not applied or migration-tested against Postgres.
-- Supabase auth.users is an external prerequisite.
-- Fail-closed: tables are RLS-enabled with NO client policies/grants below.
-- Before use, implement narrow transactional entry points for the core, with
-- authenticated subject + client-grant checks and same-decision assertions.
-- Do not grant browser/MCP clients unrestricted writes to bypass invariants.
-- Versioned JSON documents are validated by runtime schemas, not arbitrary JSON.

create table trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null, destination text not null,
  start_date date not null, end_date date not null,
  adults smallint not null check (adults between 1 and 9),
  children smallint not null default 0 check (children >= 0),
  infants smallint not null default 0 check (infants >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index trips_owner on trips(owner_id);

create table client_grants (
  owner_id uuid not null references auth.users(id), client_id text not null,
  can_read boolean not null default false,
  can_write boolean not null default false,
  can_search boolean not null default false,
  consented_at timestamptz not null, revoked_at timestamptz,
  primary key (owner_id, client_id)
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id),
  kind text not null check (kind = 'flight'), title text not null,
  revision bigint not null default 1 check (revision > 0)
);
create index decisions_trip on decisions(trip_id);

-- Append-only once published. Current version = latest version within decision.
-- Creation/version increment and decision revision increment form one transaction.
create table criteria_versions (
  decision_id uuid not null references decisions(id),
  version integer not null check (version > 0),
  schema_version integer not null check (schema_version = 1),
  constraints jsonb not null check (jsonb_typeof(constraints) = 'array'),
  preferences jsonb not null check (jsonb_typeof(preferences) = 'array'),
  assumptions jsonb not null check (jsonb_typeof(assumptions) = 'array'),
  query_currency text not null check (query_currency ~ '^[A-Z]{3}$'),
  market text not null, cabin text not null check (cabin = 'economy'),
  created_at timestamptz not null default now(),
  primary key (decision_id, version)
);

create table provider_rights_profiles (
  id text primary key, provider text not null,
  status text not null check (status in ('unreviewed','pilot_permitted','production_permitted','denied')),
  reviewed_at timestamptz, contract_reference text not null,
  policy jsonb not null check (jsonb_typeof(policy) = 'object')
);

create table search_runs (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decisions(id), criteria_version integer not null,
  status text not null check (status in ('queued','running','complete','partial','failed','cancelled')),
  freshness_mode text not null check (freshness_mode in ('allow_cache','refresh')),
  query_version text not null, request_hash text not null, idempotency_key text not null,
  max_requests integer not null check (max_requests > 0),
  reserved_requests integer not null default 0,
  coverage jsonb not null default '{}',
  created_at timestamptz not null default now(), finished_at timestamptz,
  foreign key (decision_id, criteria_version) references criteria_versions(decision_id, version),
  unique (id, decision_id), unique (decision_id, idempotency_key),
  check (reserved_requests between 0 and max_requests)
);

create table search_jobs (
  run_id uuid primary key references search_runs(id),
  due_at timestamptz not null default now(),
  lease_owner text, lease_until timestamptz,
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  checkpoint jsonb not null default '{}',
  check ((lease_owner is null) = (lease_until is null))
);
create index search_jobs_due on search_jobs(due_at, lease_until);

create table provider_attempts (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references search_runs(id),
  provider text not null, adapter_version text not null,
  ordinal integer not null check (ordinal > 0), request_hash text not null,
  provider_request_id text,
  status text not null check (status in ('reserved','sent','complete','failed','outcome_unknown')),
  requested_at timestamptz, completed_at timestamptz,
  unique (run_id, ordinal)
);

create table candidates (
  id uuid primary key default gen_random_uuid(), decision_id uuid not null references decisions(id),
  identity_key text not null, identity_version integer not null,
  identity_confidence text not null check (identity_confidence in ('operating_flights','provider_scoped')),
  disposition text not null default 'neutral' check (disposition in ('neutral','saved','rejected')),
  disposition_reason text, revision bigint not null default 1 check (revision > 0),
  unique (id, decision_id), unique (decision_id, identity_version, identity_key)
);

create table flight_segments (
  candidate_id uuid not null references candidates(id),
  direction text not null check (direction in ('outbound','inbound')),
  ordinal smallint not null check (ordinal > 0),
  origin text not null, destination text not null, departure_local_date date not null,
  operating_carrier text, operating_flight_number text, provider_identity text,
  primary key (candidate_id, direction, ordinal),
  check ((operating_carrier is not null and operating_flight_number is not null) or provider_identity is not null)
);

-- Append-only observations; content may be redacted under retention policy.
create table offer_observations (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null, candidate_id uuid not null, run_id uuid,
  provider text not null, provider_offer_id text, seller text, fare_identity text,
  adults smallint not null check (adults between 1 and 9),
  children smallint not null check (children >= 0), infants smallint not null check (infants >= 0),
  cabin text not null check (cabin = 'economy'),
  retrieved_at timestamptz not null, source_observed_at timestamptz, expires_at timestamptz,
  freshness text not null check (freshness in ('live_response','provider_cache','manual','unknown')),
  price_minor bigint check (price_minor >= 0), currency text check (currency ~ '^[A-Z]{3}$'),
  price_basis text not null check (price_basis in ('party','per_person','unknown')),
  comparable_group_total_minor bigint check (comparable_group_total_minor >= 0),
  completeness text not null check (completeness in ('complete','partial','unknown')),
  availability text not null check (availability in ('quoted','unavailable','unknown')),
  booking_url text, retain_until timestamptz,
  rights_profile_id text not null references provider_rights_profiles(id),
  foreign key (candidate_id, decision_id) references candidates(id, decision_id),
  foreign key (run_id, decision_id) references search_runs(id, decision_id),
  unique (id, decision_id), unique (id, candidate_id),
  check ((price_minor is null) = (currency is null)),
  check (comparable_group_total_minor is null or (completeness = 'complete' and currency is not null and price_basis <> 'unknown'))
);
create index observations_run on offer_observations(run_id);
create index observations_candidate_time on offer_observations(candidate_id, retrieved_at desc);

create table segment_observations (
  observation_id uuid not null, candidate_id uuid not null,
  direction text not null, ordinal smallint not null,
  scheduled_departure timestamptz not null, scheduled_arrival timestamptz not null,
  departure_timezone text not null, arrival_timezone text not null,
  marketing_carrier text, marketing_flight_number text,
  primary key (observation_id, direction, ordinal),
  foreign key (observation_id, candidate_id) references offer_observations(id, candidate_id),
  foreign key (candidate_id, direction, ordinal) references flight_segments(candidate_id, direction, ordinal),
  check (scheduled_arrival > scheduled_departure)
);

create table evidence (
  id uuid primary key default gen_random_uuid(), observation_id uuid not null references offer_observations(id),
  field text not null, value jsonb,
  source_url text, source_type text not null check (source_type in ('provider','user_reported','policy_page')),
  observed_at timestamptz, retrieved_at timestamptz not null,
  expires_at timestamptz, retain_until timestamptz, attribution text,
  status text not null check (status in ('available','expired','redacted')),
  unique (id, observation_id)
);

create table price_components (
  id uuid primary key default gen_random_uuid(), observation_id uuid not null references offer_observations(id),
  kind text not null check (kind in ('fare_and_tax','snowboard','checked_bag','seat','transfer','other')),
  coverage_key text not null,
  amount_minor bigint check (amount_minor >= 0), currency text check (currency ~ '^[A-Z]{3}$'),
  basis text not null check (basis in ('party','per_person','per_item','unknown')),
  quantity integer check (quantity > 0), direction text not null check (direction in ('outbound','inbound','both')),
  treatment text not null check (treatment in ('included','additional','unknown')),
  provenance text not null check (provenance in ('provider','user_reported','estimate')),
  evidence_id uuid,
  foreign key (evidence_id, observation_id) references evidence(id, observation_id),
  unique (observation_id, coverage_key),
  check ((amount_minor is null) = (currency is null))
);

create table evaluations (
  id uuid primary key default gen_random_uuid(), decision_id uuid not null,
  observation_id uuid not null, criteria_version integer not null,
  algorithm_version text not null, evaluated_at timestamptz not null,
  eligibility text not null check (eligibility in ('eligible','conditional','ineligible')),
  checks jsonb not null, metrics jsonb not null,
  score_lower numeric, score_upper numeric, known_weight numeric,
  foreign key (observation_id, decision_id) references offer_observations(id, decision_id),
  foreign key (decision_id, criteria_version) references criteria_versions(decision_id, version),
  check ((score_lower is null and score_upper is null and known_weight is null) or
    (score_lower is not null and score_upper is not null and known_weight is not null and
     score_lower between 0 and 100 and score_upper between score_lower and 100 and known_weight between 0 and 1))
);

create table selections (
  id uuid primary key default gen_random_uuid(), decision_id uuid not null,
  observation_id uuid not null, criteria_version integer not null,
  rationale text not null, unresolved_conditions jsonb not null default '[]',
  selected_at timestamptz not null default now(), superseded_at timestamptz,
  foreign key (observation_id, decision_id) references offer_observations(id, decision_id),
  foreign key (decision_id, criteria_version) references criteria_versions(decision_id, version)
);
create unique index one_current_selection on selections(decision_id) where superseded_at is null;

create table booking_records (
  id uuid primary key default gen_random_uuid(), selection_id uuid not null references selections(id),
  reported_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
  booked_at timestamptz not null, amount_minor bigint check (amount_minor >= 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('user_reported_booked','user_reported_cancelled')),
  reference_summary text,
  check ((amount_minor is null) = (currency is null))
);

create table mutation_requests (
  owner_id uuid not null references auth.users(id), operation text not null,
  idempotency_key text not null, request_hash text not null,
  response jsonb, created_at timestamptz not null default now(),
  primary key (owner_id, operation, idempotency_key)
);

-- API/worker transactions still required: budget reservation, lease fencing,
-- criteria append-only, optimistic revisions, semantic party/price/evidence checks,
-- same-owner booking reporter, client consent, retention and explicit trip deletion.
-- Foreign keys intentionally restrict deletion; deletion must traverse the graph
-- transactionally (including private evidence) rather than orphaning child records.
-- RLS alone does not constrain a service-role/superuser connection.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'trips','client_grants','decisions','criteria_versions','provider_rights_profiles',
    'search_runs','search_jobs','provider_attempts','candidates','flight_segments',
    'offer_observations','segment_observations','evidence','price_components',
    'evaluations','selections','booking_records','mutation_requests'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('revoke all on table %I from anon, authenticated', table_name);
  end loop;
end $$;

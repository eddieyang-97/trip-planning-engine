alter table trips add column archived_at timestamptz;
alter table trips add column archived_by uuid;
alter table trips add column lifecycle_revision integer not null default 1 check(lifecycle_revision>0);
alter table trips add constraint trip_archive_actor check((archived_at is null)=(archived_by is null));
alter table mutation_requests add column trip_id uuid;
-- Preserve retry guards when content is erased, including old create-trip keys.
update mutation_requests m set trip_id=t.id from trips t where m.response->>'tripId'=t.id::text;
update mutation_requests m set trip_id=d.trip_id from decisions d where m.response->>'decisionId'=d.id::text;
update mutation_requests m set trip_id=d.trip_id from search_runs r join decisions d on d.id=r.decision_id where m.response->>'runId'=r.id::text;
update mutation_requests m set trip_id=d.trip_id from candidates c join decisions d on d.id=c.decision_id where m.response->>'candidateId'=c.id::text;
update mutation_requests m set trip_id=d.trip_id from observations o join decisions d on d.id=o.decision_id where m.response->>'observationId'=o.id::text;
update mutation_requests m set trip_id=d.trip_id from selections s join decisions d on d.id=s.decision_id where m.response->>'selectionId'=s.id::text;
update mutation_requests m set trip_id=d.trip_id from booking_records b join selections s on s.id=b.selection_id join decisions d on d.id=s.decision_id where m.response->>'bookingRecordId'=b.id::text;
update mutation_requests m set trip_id=i.trip_id from itinerary_items i where m.response->>'itemId'=i.id::text;
update mutation_requests m set trip_id=c.trip_id from itinerary_comments c where m.response->>'commentId'=c.id::text;
update mutation_requests m set trip_id=i.trip_id from itinerary_invites i where m.response->>'inviteId'=i.id::text;
create index mutation_requests_trip on mutation_requests(trip_id);
create table trip_deletions(trip_id uuid primary key,deleted_at timestamptz not null default now());
create table trip_action_confirmations(
  token_hash text primary key,trip_id uuid not null references trips(id),user_id uuid not null,client_id text not null,
  action text not null check(action in ('delete','leave')),revision integer not null,expires_at timestamptz not null
);
create index trip_action_confirmation_trip on trip_action_confirmations(trip_id);
-- This quota-only ledger must survive trip deletion. It contains no travel data.
create table live_search_usage(
  reservation_id uuid primary key,requested_by uuid,requests integer not null check(requests between 0 and 3),created_at timestamptz not null default now()
);
insert into live_search_usage select id,requested_by,reserved_requests,created_at from search_runs where provider='serpapi';
create index live_search_usage_window on live_search_usage(created_at,requested_by);
alter table trip_deletions enable row level security;
alter table trip_action_confirmations enable row level security;
alter table live_search_usage enable row level security;
revoke all on trip_deletions,trip_action_confirmations,live_search_usage from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on trip_deletions,trip_action_confirmations,live_search_usage from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on trip_deletions,trip_action_confirmations,live_search_usage from authenticated; end if;
end $$;

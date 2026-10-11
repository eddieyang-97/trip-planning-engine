alter table trips add column itinerary_revision integer not null default 1 check(itinerary_revision>0);
create table itinerary_items (
  id uuid primary key, trip_id uuid not null references trips(id), payload jsonb not null,
  position integer not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), removed_at timestamptz
);
create index itinerary_items_trip on itinerary_items(trip_id,position);
create table itinerary_events (
  id uuid primary key, trip_id uuid not null references trips(id), item_id uuid references itinerary_items(id),
  actor_id uuid not null, action text not null check(action in ('added','edited','removed','moved')),
  before_payload jsonb, after_payload jsonb, revision integer not null,
  created_at timestamptz not null default now()
);
create index itinerary_events_trip on itinerary_events(trip_id,revision);
alter table itinerary_items enable row level security;
alter table itinerary_events enable row level security;
revoke all on itinerary_items,itinerary_events from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on itinerary_items,itinerary_events from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on itinerary_items,itinerary_events from authenticated;
  end if;
end $$;

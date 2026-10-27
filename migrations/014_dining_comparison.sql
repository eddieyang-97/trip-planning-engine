-- Dining keeps the shared research graph; existing flight/stay payloads stay unchanged.
alter table decisions drop constraint decisions_kind_check;
alter table decisions add constraint decisions_kind_check check(kind in ('flight','stay','dining'));
create table dining_itinerary_links(
  selection_id uuid primary key,trip_id uuid not null,decision_id uuid not null,candidate_id uuid not null,
  observation_id uuid not null,item_id uuid not null unique,created_by uuid not null,created_at timestamptz not null default now(),
  foreign key(decision_id,trip_id) references decisions(id,trip_id) on delete cascade,
  foreign key(candidate_id,decision_id) references candidates(id,decision_id) on delete cascade,
  foreign key(observation_id,candidate_id,decision_id) references observations(id,candidate_id,decision_id) on delete cascade,
  foreign key(selection_id,observation_id,decision_id) references selections(id,observation_id,decision_id) on delete cascade,
  foreign key(item_id,trip_id) references itinerary_items(id,trip_id) on delete cascade
);
create index dining_links_decision on dining_itinerary_links(decision_id);
alter table dining_itinerary_links enable row level security;
revoke all on dining_itinerary_links from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on dining_itinerary_links from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on dining_itinerary_links from authenticated; end if;
end $$;

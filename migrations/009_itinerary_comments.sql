alter table itinerary_items add constraint itinerary_items_id_trip unique(id,trip_id);
create table itinerary_comments (
  id uuid primary key, trip_id uuid not null references trips(id), item_id uuid,
  author_id uuid not null, author_label text not null check(length(author_label) between 1 and 60),
  author_role text not null check(author_role in ('owner','editor')),
  body text not null check(length(body) between 1 and 2000),
  created_at timestamptz not null default now(), deleted_at timestamptz, deleted_by uuid,
  foreign key(item_id,trip_id) references itinerary_items(id,trip_id),
  check((deleted_at is null)=(deleted_by is null))
);
create index itinerary_comments_trip on itinerary_comments(trip_id,created_at,id);
create index itinerary_comments_item on itinerary_comments(trip_id,item_id,created_at,id);
alter table itinerary_comments enable row level security;
revoke all on itinerary_comments from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on itinerary_comments from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on itinerary_comments from authenticated; end if;
end $$;

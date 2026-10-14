-- Existing invitations and memberships remain view-only.
alter table itinerary_invites add column role text not null default 'viewer'
  check(role in ('viewer','editor'));
alter table itinerary_members drop constraint itinerary_members_role_check;
alter table itinerary_members add constraint itinerary_members_role_check
  check(role in ('viewer','editor'));

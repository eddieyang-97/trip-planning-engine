-- Preserve every existing account-bound invitation. Anonymous access is granted
-- only by the new, explicit create_itinerary_view_link operation.
alter table itinerary_invites add column access_mode text not null default 'account'
  check(access_mode in ('account','link'));
alter table itinerary_invites alter column expires_at drop not null;
alter table itinerary_invites add constraint itinerary_view_link_read_only check(
  access_mode='account' or (role='viewer' and accepted_by is null and accepted_at is null)
);
alter table itinerary_invites add constraint itinerary_account_invite_expiry check(
  access_mode='link' or expires_at is not null
);

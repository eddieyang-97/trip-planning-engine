alter table observations drop constraint observations_provenance_check;
alter table observations add constraint observations_provenance_check check (
  provenance in ('synthetic', 'user_reported', 'provider_reported')
  or (provenance = 'assistant_sourced_unverified' and run_id is null
    and created_by is not null and jsonb_typeof(payload #> '{external,reportedPrice}') is not distinct from 'object'
    and (payload->'priceMinor') is not distinct from 'null'::jsonb
    and (payload->'priceBasis') is not distinct from '"unknown"'::jsonb
    and (payload->'exactPartyQuoted') is not distinct from 'false'::jsonb)
);

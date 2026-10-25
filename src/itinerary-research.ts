import type {Queryable} from './database.js';
import type {Criteria, Offer, Provenance} from './domain.js';

export interface ItineraryObservation {
  id:string; candidateId:string; disposition:'neutral'|'saved'|'rejected'; provenance:Provenance;
  offer:Offer; selected:boolean; bookingReported:boolean;
}
export interface ItineraryResearchDecision {
  id:string; title:string; revision?:number; bookingLinked?:boolean; criteriaVersion:number; criteria:Criteria;
  latestRun:{id:string;status:string;criteriaVersion:number;createdAt:string;coverage:Record<string,unknown>}|null;
  observations:ItineraryObservation[]; observationCount:number; pinnedEvidenceTruncated?:boolean;
}
export interface ItineraryResearch {decisions:ItineraryResearchDecision[]; truncatedDecisions:boolean; archivedCount?:number}

// Called only after trip ownership is established, within the same repeatable-read snapshot.
// Return presentation data, never provider tokens, OAuth grants or the supplier request ledger.
export async function itineraryResearch(tx:Queryable,tripId:string):Promise<ItineraryResearch> {
  const decisions=(await tx.query('select d.id,d.title,d.revision,exists(select 1 from booking_records b join selections s on s.id=b.selection_id where s.decision_id=d.id) as booking_linked from decisions d where trip_id=$1 and kind=\'flight\' and archived_at is null order by title,id limit 6',[tripId])).rows;
  const result:ItineraryResearchDecision[]=[];
  for(const decision of decisions.slice(0,5)) {
    const criteria=(await tx.query('select version,payload from criteria_versions where decision_id=$1 order by version desc limit 1',[decision.id])).rows[0]!;
    const run=(await tx.query('select id,status,criteria_version,created_at,coverage from search_runs where decision_id=$1 order by created_at desc,id desc limit 1',[decision.id])).rows[0];
    // Keep the newest observation of each candidate/seller/fare; retain pinned selections/bookings
    // even if they fall outside this bounded recent-evidence window.
    const latest=`select distinct on (candidate_id,payload->>'seller',payload->>'fare') * from observations
      where decision_id=$1 order by candidate_id,payload->>'seller',payload->>'fare',created_at desc,id desc`;
    const count=(await tx.query(`select count(*)::int as n from (${latest}) recent`,[decision.id])).rows[0]!.n;
    const observations=(await tx.query(`select o.*,c.disposition from (${latest}) o
      join candidates c on c.id=o.candidate_id order by o.created_at desc,o.id desc limit 20`,[decision.id])).rows;
    const pins=(await tx.query(`select o.*,c.disposition,(s.superseded_at is null) as selected,
      exists(select 1 from booking_records b where b.selection_id=s.id) as booked
      from selections s join observations o on o.id=s.observation_id join candidates c on c.id=o.candidate_id
      where s.decision_id=$1 and (s.superseded_at is null or exists(select 1 from booking_records b where b.selection_id=s.id))
      order by s.created_at desc,s.id desc limit 21`,[decision.id])).rows;
    const rows=new Map(observations.map(o=>[o.id,o]));
    for(const pin of pins.slice(0,20)){const prior=rows.get(pin.id);rows.set(pin.id,{...pin,selected:!!pin.selected||!!prior?.selected,booked:!!pin.booked||!!prior?.booked});}
    result.push({id:decision.id,title:decision.title,revision:decision.revision,bookingLinked:decision.booking_linked,criteriaVersion:criteria.version,criteria:criteria.payload,
      latestRun:run?{id:run.id,status:run.status,criteriaVersion:run.criteria_version,createdAt:run.created_at,coverage:run.coverage}:null,
      observations:[...rows.values()].map(o=>({id:o.id,candidateId:o.candidate_id,disposition:o.disposition,
        provenance:o.provenance,offer:o.payload,selected:!!o.selected,bookingReported:!!o.booked})),observationCount:count,pinnedEvidenceTruncated:pins.length>20});
  }
  return {decisions:result,truncatedDecisions:decisions.length>5,archivedCount:(await tx.query('select count(*)::int n from decisions where trip_id=$1 and archived_at is not null',[tripId])).rows[0]!.n};
}

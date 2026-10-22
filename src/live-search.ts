import {randomUUID} from 'node:crypto';
import type {Database,Queryable} from './database.js';
import {DomainError,type Actor,type Criteria,type Offer} from './domain.js';
import {validateLiveCriteria,liveRequestLimit,liveObservationLimit,type LiveFlightProvider} from './live-provider.js';
import {lockDecisionTrip} from './trip-lifecycle.js';
import {liveSearchPlan,type LiveSearchPlan,type LiveQueryRecord} from './live-coverage.js';

export const liveLimits=Object.freeze({perRun:liveRequestLimit,perOwnerDay:6,perDay:12,per30Days:60});
interface LiveJob {id:string;decision_id:string;criteria_version:number;requested_by:string;client_id:string;grant_version:string|null;criteria:Criteria;reserved_requests:number;coverage:{plan?:LiveSearchPlan;queries?:LiveQueryRecord[]}}
export async function queueLiveSearch(tx:Queryable,actor:Actor,decisionId:string,version:number,c:Criteria) {
  validateLiveCriteria(c);
  await tx.query('select pg_advisory_xact_lock(781349, 2)');
  const usage=(await tx.query(`select
    coalesce(sum(requests) filter(where created_at>now()-interval '1 day'),0)::int as daily,
    coalesce(sum(requests) filter(where created_at>now()-interval '1 day' and requested_by=$1),0)::int as owner_daily,
    coalesce(sum(requests),0)::int as monthly
    from live_search_usage where created_at>now()-interval '30 days'`,[actor.userId])).rows[0]!;
  if(usage.daily+3>liveLimits.perDay||usage.owner_daily+3>liveLimits.perOwnerDay||usage.monthly+3>liveLimits.per30Days)
    throw new DomainError('BUDGET_EXCEEDED','Live pilot search allowance reached. Limits: two runs per owner per rolling day; four globally per day and twenty per 30 days.');
  const id=randomUUID();
  const plan=liveSearchPlan(c);
  await tx.query("delete from live_search_usage where created_at<=now()-interval '30 days'");
  await tx.query('insert into live_search_usage(reservation_id,requested_by,requests) values($1,$2,3)',[id,actor.userId]);
  await tx.query(`insert into search_runs(id,decision_id,criteria_version,provider,status,requested_by,client_id,grant_version,reserved_requests,coverage)
    values($1,$2,$3,'serpapi','queued',$4,$5,$6,3,$7)`,[id,decisionId,version,actor.userId,actor.clientId,actor.grantVersion??null,JSON.stringify({plan,queries:[],complete:false})]);
  return {runId:id,status:'queued',provenance:'provider_reported',maximumProviderRequests:3,
    searchPlan:plan,coverage:'Economy discovery: one-way queries up to three origins individually in saved order; returns use a combined query and up to two return expansions. Inspect per-pair coverage; market, seller and baggage coverage remain incomplete.'};
}
async function stillAuthorized(tx:Queryable,job:Pick<LiveJob,'requested_by'|'client_id'|'grant_version'>) {
  const grant=(await tx.query(`select g.permissions,c.grant_version from client_grants g
    left join oauth_connections c on c.owner_id=g.owner_id and c.client_id=g.client_id
    where g.owner_id=$1 and g.client_id=$2 and g.revoked_at is null`,[job.requested_by,job.client_id])).rows[0];
  return !!grant&&grant.permissions.includes('write')&&grant.permissions.includes('search')
    &&(!job.grant_version||grant.grant_version===job.grant_version);
}
type SaveOffer=(tx:Queryable,decisionId:string,offer:Offer,provenance:'provider_reported',runId:string)=>Promise<unknown>;
export async function runOneLiveJob(db:Database,provider:LiveFlightProvider,saveOffer:SaveOffer,signal?:AbortSignal) {
  if(signal?.aborted)return false;
  await db.transaction(async tx=>{
    await tx.query('select pg_advisory_xact_lock(781349, 2)');
    // Root-before-child order also applies to recovery and deletion.
    const expired=(await tx.query(`select id,decision_id from search_runs where provider='serpapi' and
      ((status='running' and lease_until<now()) or (status='queued' and created_at<now()-interval '1 hour')) order by decision_id,id`)).rows;
    for(const candidate of expired){
      const trip=await lockDecisionTrip(tx,candidate.decision_id);if(!trip)continue;
      const row=(await tx.query(`select status from search_runs where id=$1 and
        ((status='running' and lease_until<now()) or (status='queued' and created_at<now()-interval '1 hour')) for update`,[candidate.id])).rows[0];if(!row)continue;
      if(row.status==='running')await tx.query("update provider_attempts set status='outcome_unknown',finished_at=now() where run_id=$1 and status='reserved'",[candidate.id]);
      await tx.query('update search_runs set status=$2,error_code=$3,finished_at=now(),lease_until=null where id=$1',[candidate.id,row.status==='running'?'outcome_unknown':'failed',row.status==='running'?'WORKER_INTERRUPTED':'QUEUE_EXPIRED']);
      await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=$1',[trip.id]);
    }
  });
  if(signal?.aborted)return false;
  const job=await db.transaction<LiveJob|null>(async tx=>{
    await tx.query('select pg_advisory_xact_lock(781349, 2)');
    if(signal?.aborted)return null;
    if((await tx.query("select id from search_runs where provider='serpapi' and status='running' limit 1")).rows.length)return null;
    const row=(await tx.query<LiveJob>(`select * from search_runs where provider='serpapi' and status='queued'
      order by created_at,id limit 1`)).rows[0];
    if(!row)return null;
    if(!await lockDecisionTrip(tx,row.decision_id))return null;
    if(!(await tx.query("select id from search_runs where id=$1 and status='queued' for update",[row.id])).rows.length)return null;
    if(!await stillAuthorized(tx,row)) {
      await tx.query("update search_runs set status='failed',error_code='AUTHORIZATION_REVOKED',finished_at=now() where id=$1",[row.id]);
      await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=(select trip_id from decisions where id=$1)',[row.decision_id]);
      return null;
    }
    if(signal?.aborted)return null;
    await tx.query("update search_runs set status='running',lease_until=now()+interval '3 minutes',generation=generation+1 where id=$1",[row.id]);
    await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=(select trip_id from decisions where id=$1)',[row.decision_id]);
    return {...row,criteria:(await tx.query('select payload from criteria_versions where decision_id=$1 and version=$2',[row.decision_id,row.criteria_version])).rows[0]!.payload as Criteria};
  });
  if(!job)return false;
  try {
    const result=await provider.search(job.criteria,async event=>{
      await db.transaction(async tx=>{
        if(!await lockDecisionTrip(tx,job.decision_id))throw new Error('Trip deleted');
        const running=(await tx.query("select id,coverage from search_runs where id=$1 and status='running' and lease_until>now() for update",[job.id])).rows[0];
        if(!running)throw new Error('Run inactive');
        if(event.status==='reserved') {
          signal?.throwIfAborted();
          if(!await stillAuthorized(tx,job))throw new Error('Authorization revoked');
          if(!Number.isInteger(event.attempt)||event.attempt<1||event.attempt>job.reserved_requests)throw new Error('Reservation exceeded');
          signal?.throwIfAborted();
          // PK, reservation and CHECK constraints prevent duplicate or excess dispatch.
          await tx.query("insert into provider_attempts(run_id,attempt,stage,status) values($1,$2,$3,'reserved')",[job.id,event.attempt,event.stage]);
        } else {
          const updated=await tx.query(`update provider_attempts set status=$3,finished_at=now(),diagnostic=$4
            where run_id=$1 and attempt=$2 and stage=$5 and status='reserved' returning attempt`,
            [job.id,event.attempt,event.status,event.diagnostic||event.resultValidation?JSON.stringify({...event.diagnostic,...(event.resultValidation?{resultValidation:{status:'rejected',reason:event.resultValidation}}:{})}):null,event.stage]);
          if(!updated.rows.length)throw new Error('Attempt inactive');
        }
        const queries:LiveQueryRecord[]=running.coverage?.queries??[];
        if(event.status==='reserved'&&event.query)queries.push({...event.query,attempt:event.attempt,stage:event.stage,status:event.status});
        else for(const query of queries)if(query.attempt===event.attempt){query.status=event.status;if(event.resultValidation)query.resultValidation=event.resultValidation;}
        await tx.query('update search_runs set coverage=$2 where id=$1',[job.id,JSON.stringify({...running.coverage,queries})]);
        await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=(select trip_id from decisions where id=$1)',[job.decision_id]);
      });
    },job.coverage?.plan??liveSearchPlan(job.criteria,true),signal);
    await db.transaction(async tx=>{
      if(!await lockDecisionTrip(tx,job.decision_id))return;
      const active=(await tx.query("select id from search_runs where id=$1 and status='running' and lease_until>now() for update",[job.id])).rows.length;
      if(!active)return;
      if(!await stillAuthorized(tx,job))throw new Error('Authorization revoked');
      const state=result.report.status==='completed'?'complete':result.report.status==='outcome_unknown'?'outcome_unknown':'failed';
      const accepted=result.offers.slice(0,liveObservationLimit);
      for(const offer of accepted)await saveOffer(tx,job.decision_id,offer,'provider_reported',job.id);
      await tx.query("update provider_attempts set status='outcome_unknown',finished_at=now() where run_id=$1 and status='reserved'",[job.id]);
      const coverage={...result.report.coverage,complete:false,synthetic:false,source:'SerpApi / Google Flights',
        requestsAttempted:result.report.requestsAttempted,maximumProviderRequests:3,
        acceptedObservationCount:accepted.length,
        priceBasisVerified:false,snowboardVerified:false,criteriaVersion:job.criteria_version};
      await tx.query(`update search_runs set status=$2,finished_at=now(),lease_until=null,error_code=$3,coverage=$4 where id=$1`,
        [job.id,state,state==='complete'?null:result.report.reason,JSON.stringify(coverage)]);
      await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=(select trip_id from decisions where id=$1)',[job.decision_id]);
    });
  }catch {
    // No raw exception text: upstream exceptions can contain secret-bearing URLs.
    await db.transaction(async tx=>{
      const trip=await lockDecisionTrip(tx,job.decision_id);if(!trip)return;
      await tx.query("update provider_attempts set status='outcome_unknown',finished_at=now() where run_id=$1 and status='reserved'",[job.id]);
      await tx.query(`update search_runs set status='outcome_unknown',error_code='LIVE_WORKER_FAILED',finished_at=now(),lease_until=null
        where id=$1 and status='running'`,[job.id]);
      await tx.query('update trips set lifecycle_revision=lifecycle_revision+1 where id=$1',[trip.id]);
    });
  }
  return true;
}

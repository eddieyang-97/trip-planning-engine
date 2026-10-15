import {randomBytes} from 'node:crypto';
import {Router,json} from 'express';
import {z} from 'zod';
import type {Core} from './core.js';
import {DomainError} from './domain.js';
import {readItineraryViewLink,viewLinkReadSchema} from './itinerary-view-links.js';
import {calendarFile,type CalendarPlan} from './calendar-export.js';

const selection={itemIds:z.array(z.uuid()).min(1).max(500),expectedRevision:z.number().int().positive()};
const direct=z.strictObject({...selection,tripId:z.uuid()});
const shared=z.strictObject({...selection,token:viewLinkReadSchema.shape.token});
const lifetime=2*60_000;
type Ticket={body:string;bytes:number;filename:string;expires:number;check:()=>Promise<unknown>};
export function calendarExportRoutes(options:{core:Core;origin:string;authenticate?:(header?:string)=>Promise<{userId:string}>;clock?:()=>number}){
  const router=Router(),tickets=new Map<string,Ticket>(),clock=options.clock??Date.now;
  let windowStart=clock(),requests=0;
  router.use(['/itinerary/calendar','/itinerary-api/calendar-export','/itinerary-share/calendar-export'],(_req,res,next)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'");next();
  });
  router.post(['/itinerary-api/calendar-export','/itinerary-share/calendar-export'],json({limit:'32kb'}),async(req,res)=>{
    if(req.headers.origin!==options.origin){res.status(403).json({error:'Open the itinerary page to export.'});return;}
    const now=clock();
    if(now-windowStart>=60_000){windowStart=now;requests=0;}
    if(++requests>60){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many calendar exports. Please try again in a minute.'});return;}
    for(const [token,ticket]of tickets)if(ticket.expires<=now)tickets.delete(token);
    if(tickets.size>=120){res.status(429).json({error:'Please wait two minutes before preparing another export.'});return;}
    try{
      let plan:CalendarPlan,check:Ticket['check'],itemIds:string[],revision:number;
      if(req.path==='/itinerary-share/calendar-export'){
        const a=shared.parse(req.body);itemIds=a.itemIds;revision=a.expectedRevision;
        const read=()=>readItineraryViewLink(options.core.db,{token:a.token});
        plan=await read();check=read;
      }else{
        if(!options.authenticate){res.status(401).json({error:'Sign in to your travel account.'});return;}
        const authorization=req.headers.authorization;
        let actor:{userId:string};
        try{actor=await options.authenticate(authorization);}catch{res.status(401).json({error:'Sign in to your travel account.'});return;}
        const a=direct.parse(req.body);itemIds=a.itemIds;revision=a.expectedRevision;
        plan=await options.core.callFromWeb('get_itinerary',{tripId:a.tripId},actor.userId) as CalendarPlan;
        check=async()=>{
          const current=await options.authenticate!(authorization);
          if(current.userId!==actor.userId)throw Error('Account changed');
          await options.core.callFromWeb('get_itinerary',{tripId:a.tripId},current.userId);
        };
      }
      if(plan.revision!==revision){res.status(409).json({error:'The itinerary changed. Refresh it before exporting.'});return;}
      let body:string;
      try{body=calendarFile(plan,itemIds,new Date(now));}catch(error){res.status(400).json({error:error instanceof Error?error.message:'Check the selected items.'});return;}
      const bytes=Buffer.byteLength(body);
      if(bytes>8_000_000){res.status(400).json({error:'This export is too large. Select fewer items and try again.'});return;}
      if([...tickets.values()].reduce((sum,ticket)=>sum+ticket.bytes,0)+bytes>16_000_000){res.status(429).json({error:'Calendar exports are busy. Please try again in two minutes.'});return;}
      const token=randomBytes(32).toString('base64url'),expires=now+lifetime;
      const filename=(plan.trip.payload.name.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,80)||'itinerary')+'.ics';
      tickets.set(token,{body,bytes,filename,expires,check});
      setTimeout(()=>tickets.delete(token),lifetime).unref();
      res.json({url:'/itinerary/calendar/'+token+'.ics',eventCount:itemIds.length,expiresAt:new Date(expires).toISOString()});
    }catch(error){
      res.status(error instanceof z.ZodError?400:error instanceof DomainError?404:500)
        .json({error:error instanceof z.ZodError?'Check the calendar selection.':error instanceof DomainError?error.message:'Unable to prepare the calendar. Please try again.'});
    }
  });
  router.get('/itinerary/calendar/:file',async(req,res)=>{
    const token=req.params.file.replace(/\.ics$/,'');
    const ticket=tickets.get(token);
    const unavailable=()=>res.status(404).type('text').send('This calendar export is unavailable or expired. Return to the itinerary and export again.');
    if(!/^[A-Za-z0-9_-]{43}\.ics$/.test(req.params.file)||!ticket)return void unavailable();
    if(ticket.expires<=clock()){tickets.delete(token);return void unavailable();}
    // Calendar's native handoff cannot send the web bearer header. The short-
    // lived opaque URL serves only this snapshot; source access is rechecked.
    try{await ticket.check();}catch{tickets.delete(token);return void unavailable();}
    if(ticket.expires<=clock()){tickets.delete(token);return void unavailable();}
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition',(req.query.download==='1'?'attachment':'inline')+'; filename="'+ticket.filename+'"');
    res.send(ticket.body);
  });
  return router;
}

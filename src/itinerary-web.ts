import { Router, json } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Core, type ToolName } from './core.js';
import { DomainError } from './domain.js';
import {readItineraryViewLink} from './itinerary-view-links.js';
import {calendarExportRoutes} from './calendar-export-web.js';
import {itineraryAccess} from './itinerary.js';
import {MapPlaces,placeSearchSchema} from './map-places.js';

export function itineraryRoutes(options:{core:Core;origin:string;authenticate?:(header?:string)=>Promise<{userId:string}>;
  supabaseUrl?:string;publishableKey?:string;local?:boolean;mapPlaces?:MapPlaces}) {
  const router=Router();
  const places=options.mapPlaces??new MapPlaces();
  const tileUrl=process.env.MAP_TILE_URL??'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileOrigin=new URL(tileUrl).origin;
  if(!tileOrigin.startsWith('https://'))throw Error('Map tiles require HTTPS');
  router.use(calendarExportRoutes(options));
  router.use(['/itinerary','/itinerary-api','/itinerary-share','/assets/itinerary.js','/assets/itinerary.css','/assets/itinerary-views.css'],(_req,res,next)=>{
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${options.supabaseUrl??''}; img-src 'self' ${tileOrigin}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');next();
  });
  router.get('/itinerary',async(_req,res)=>res.type('html').send(await readFile(new URL('../web/itinerary.html',import.meta.url),'utf8')));
  router.get('/assets/itinerary.css',async(_req,res)=>res.type('css').send(await readFile(new URL('../web/itinerary.css',import.meta.url),'utf8')));
  router.get('/assets/itinerary-views.css',async(_req,res)=>res.type('css').send(await readFile(new URL('../web/itinerary-views.css',import.meta.url),'utf8')));
  router.get('/assets/leaflet.css',async(_req,res)=>res.type('css').send(await readFile(resolve('node_modules/leaflet/dist/leaflet.css'),'utf8')));
  router.get('/assets/leaflet-license.txt',async(_req,res)=>res.type('text').send(await readFile(new URL('../web/leaflet-license.txt',import.meta.url),'utf8')));
  router.get('/assets/itinerary.js',async(_req,res)=>res.type('application/javascript').send(await readFile(resolve('dist/web/itinerary.js'),'utf8')));
  router.get('/itinerary/config',(_req,res)=>res.json({mode:options.local?'local':options.authenticate?'hosted':'unavailable',
    supabaseUrl:options.supabaseUrl,publishableKey:options.publishableKey}));
  router.get('/itinerary/map-config',(_req,res)=>res.json({tileUrl,attribution:process.env.MAP_TILE_ATTRIBUTION??'© OpenStreetMap contributors'}));
  // One fixed read operation accepts only a view-link credential. It cannot
  // dispatch tools, join a membership, or use a client-supplied trip/owner ID.
  let readWindow=Date.now(),reads=0;
  router.post('/itinerary-share/read',json({limit:'2kb'}),async(req,res)=>{
    if(req.headers.origin!==options.origin){res.status(403).json({error:'Open the shared itinerary to view it.'});return;}
    if(Date.now()-readWindow>=60000){readWindow=Date.now();reads=0;}
    if(++reads>120){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many shared-view requests. Please try again in a minute.'});return;}
    try{res.json(await readItineraryViewLink(options.core.db,req.body));}
    catch(error){res.status(error instanceof z.ZodError?400:error instanceof DomainError?404:500).json({error:error instanceof z.ZodError?'This view link is incomplete. Ask the owner for a new link.':error instanceof DomainError?error.message:'Unable to load this shared itinerary. Try again later.'});}
  });
  router.all('/itinerary-share/read',(_req,res)=>{res.setHeader('Allow','POST');res.status(405).json({error:'Open the shared itinerary to view it.'});});
  router.use('/itinerary-api',async(req,res,next)=>{
    if(req.method!=='GET'&&req.headers.origin!==options.origin){res.status(403).json({error:'Open the itinerary page to make changes.'});return;}
    try{if(!options.authenticate)throw Error('Unavailable');res.locals.userId=(await options.authenticate(req.headers.authorization)).userId;next();}
    catch{res.status(401).json({error:'Sign in to your travel account.'});}
  },json({limit:'32kb'}));
  router.post('/itinerary-api/place-search',async(req,res)=>{
    try{
      const args=placeSearchSchema.parse(req.body),user=res.locals.userId;
      const check=()=>options.core.db.transaction(tx=>itineraryAccess(tx,args.tripId,user,true,true));
      await check();const results=await places.search(args.query,user);await check();
      res.json({places:results,attribution:'© OpenStreetMap contributors · Search by Photon'});
    }catch(error){const code=error instanceof DomainError?error.code:error instanceof z.ZodError?'VALIDATION_ERROR':'PROVIDER_UNAVAILABLE';
      if(code==='RATE_LIMITED')res.setHeader('Retry-After','2');
      res.status(code==='FORBIDDEN_OR_NOT_FOUND'?404:code==='VALIDATION_ERROR'?400:code==='RATE_LIMITED'?429:503).json({code,error:error instanceof DomainError?error.message:code==='VALIDATION_ERROR'?'Enter a place name between 3 and 200 characters.':'Place search is unavailable. Try again later.'});}
  });
  router.post('/itinerary-api/:operation',async(req,res)=>{
    const name=req.params.operation as ToolName;
    try{res.json(await options.core.callFromWeb(name,req.body,res.locals.userId));}
    catch(error){const code=error instanceof DomainError?error.code:error instanceof z.ZodError?'VALIDATION_ERROR':'INTERNAL_ERROR';
      res.status(code==='REVISION_CONFLICT'||code==='IDEMPOTENCY_CONFLICT'?409:code==='FORBIDDEN_OR_NOT_FOUND'?404:code==='INTERNAL_ERROR'?500:400)
        .json({code,error:error instanceof DomainError?error.message:error instanceof z.ZodError?error.issues.map(i=>i.message).join('; '):'Unable to save. Retry the same request.'});}
  });
  return router;
}

import { Router, json } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Core, type ToolName } from './core.js';
import { DomainError } from './domain.js';

export function itineraryRoutes(options:{core:Core;origin:string;authenticate?:(header?:string)=>Promise<{userId:string}>;
  supabaseUrl?:string;publishableKey?:string;local?:boolean}) {
  const router=Router();
  router.use(['/itinerary','/itinerary-api','/assets/itinerary.js','/assets/itinerary.css','/assets/itinerary-views.css'],(_req,res,next)=>{
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${options.supabaseUrl??''}; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();
  });
  router.get('/itinerary',async(_req,res)=>res.type('html').send(await readFile(new URL('../web/itinerary.html',import.meta.url),'utf8')));
  router.get('/assets/itinerary.css',async(_req,res)=>res.type('css').send(await readFile(new URL('../web/itinerary.css',import.meta.url),'utf8')));
  router.get('/assets/itinerary-views.css',async(_req,res)=>res.type('css').send(await readFile(new URL('../web/itinerary-views.css',import.meta.url),'utf8')));
  router.get('/assets/itinerary.js',async(_req,res)=>res.type('application/javascript').send(await readFile(resolve('dist/web/itinerary.js'),'utf8')));
  router.get('/itinerary/config',(_req,res)=>res.json({mode:options.local?'local':options.authenticate?'hosted':'unavailable',
    supabaseUrl:options.supabaseUrl,publishableKey:options.publishableKey}));
  router.use('/itinerary-api',async(req,res,next)=>{
    if(req.method!=='GET'&&req.headers.origin!==options.origin){res.status(403).json({error:'Open the itinerary page to make changes.'});return;}
    try{if(!options.authenticate)throw Error('Unavailable');res.locals.userId=(await options.authenticate(req.headers.authorization)).userId;next();}
    catch{res.status(401).json({error:'Sign in to your travel account.'});}
  },json({limit:'32kb'}));
  router.post('/itinerary-api/:operation',async(req,res)=>{
    const name=req.params.operation as ToolName;
    try{res.json(await options.core.callFromWeb(name,req.body,res.locals.userId));}
    catch(error){const code=error instanceof DomainError?error.code:error instanceof z.ZodError?'VALIDATION_ERROR':'INTERNAL_ERROR';
      res.status(code==='REVISION_CONFLICT'||code==='IDEMPOTENCY_CONFLICT'?409:code==='FORBIDDEN_OR_NOT_FOUND'?404:code==='INTERNAL_ERROR'?500:400)
        .json({code,error:error instanceof DomainError?error.message:error instanceof z.ZodError?error.issues.map(i=>i.message).join('; '):'Unable to save. Retry the same request.'});}
  });
  return router;
}

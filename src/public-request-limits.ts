import type {Request} from 'express';

// Fixed windows keep both work and memory bounded. Reject new identities when
// full instead of evicting a caller's counter (which would reset its allowance).
export function publicRequestLimits(perCaller:number,attemptLimit:number,authorizedLimit:number,clock=Date.now){
  const callers=new Map<string,number>();
  let start=clock(),attempts=0,authorized=0;
  function reset(){if(clock()-start>=60_000){start=clock();callers.clear();attempts=0;authorized=0;}}
  return {
    attempt(req:Request){
      reset();
      // Express uses the socket peer unless explicit proxy addresses are trusted.
      // Never key by a caller-supplied token, Origin, or the leftmost raw XFF.
      const caller=req.ip??req.socket.remoteAddress??'unknown';
      const count=callers.get(caller)??0;
      if(count>=perCaller||attempts>=attemptLimit||(!callers.has(caller)&&callers.size>=1024))return false;
      callers.set(caller,count+1);attempts++;return true;
    },
    authorize(){reset();if(authorized>=authorizedLimit)return false;authorized++;return true;},
  };
}

// Process-local scheduling only. Database admission/leases remain authoritative across instances.
export function startSearchWorker(work:(signal:AbortSignal)=>Promise<void>,onError:()=>void,intervalMs=1000) {
  const shutdown=new AbortController();
  let active:Promise<void>|undefined,stopping=false,drained:Promise<void>|undefined;
  const timer=setInterval(()=>{
    if(stopping||active)return;
    active=(async()=>{await work(shutdown.signal);})().catch(onError).finally(()=>{active=undefined;});
  },intervalMs);
  return {
    stop():Promise<void>{
      if(!drained){stopping=true;clearInterval(timer);shutdown.abort();drained=(async()=>{await active;})();}
      return drained;
    },
  };
}

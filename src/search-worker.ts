// Process-local scheduling only. Database admission/leases remain authoritative across instances.
export function startSearchWorker(work:()=>Promise<void>,onError:()=>void,intervalMs=1000) {
  let active:Promise<void>|undefined,stopping=false,drained:Promise<void>|undefined;
  const timer=setInterval(()=>{
    if(stopping||active)return;
    active=(async()=>{await work();})().catch(onError).finally(()=>{active=undefined;});
  },intervalMs);
  return {
    stop():Promise<void>{
      if(!drained){stopping=true;clearInterval(timer);drained=(async()=>{await active;})();}
      return drained;
    },
  };
}

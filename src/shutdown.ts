// Bound process cleanup separately from supplier request deadlines. Forced exit leaves journals intact.
export function serviceShutdown(options:{
  stopWork:()=>Promise<void>|undefined;
  closeHttp:()=>Promise<void>;
  closeDatabase:()=>Promise<void>;
  onFailure:(reason:'deadline'|'failed')=>void;
  deadlineMs?:number;
}) {
  let stopped:Promise<void>|undefined;
  return ()=>{
    if(stopped)return stopped;
    let failed=false;
    const fail=(reason:'deadline'|'failed')=>{if(!failed){failed=true;options.onFailure(reason);}};
    const deadline=setTimeout(()=>fail('deadline'),options.deadlineMs??25_000);
    deadline.unref();
    stopped=(async()=>{
      const drained=options.stopWork(); // Signal before waiting on HTTP or the database.
      await Promise.all([drained,options.closeHttp()]);
      await options.closeDatabase();
    })().catch(()=>fail('failed')).finally(()=>clearTimeout(deadline));
    return stopped;
  };
}

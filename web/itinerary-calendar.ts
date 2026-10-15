import {calendarChoices,calendarFile,type CalendarPlan,type CalendarChoice} from '../src/calendar-export.js';
type Prepared={url:string;eventCount:number;expiresAt?:string};
export function configureCalendarExport(options:{getPlan:()=>CalendarPlan|null;prepare:(plan:CalendarPlan,itemIds:string[])=>Promise<Prepared>;demo:boolean}){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const dialog=$<HTMLDialogElement>('calendar-dialog'),form=$<HTMLFormElement>('calendar-form');
  const selected=new Set<string>();let choices:CalendarChoice[]=[],opened:CalendarPlan|null=null,busy=false,attempt=0;
  let blobUrl:string|null=null,expiryTimer:ReturnType<typeof setTimeout>|undefined;
  function clearReady(){
    $('calendar-ready').hidden=true;$<HTMLAnchorElement>('calendar-open').removeAttribute('href');$<HTMLAnchorElement>('calendar-download').removeAttribute('href');
    if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
    if(expiryTimer)clearTimeout(expiryTimer);expiryTimer=undefined;
  }
  function update(){
    const excluded=choices.filter(c=>c.reason).length;
    $('calendar-count').textContent=selected.size+' selected · '+excluded+' unavailable';
    $<HTMLButtonElement>('calendar-submit').disabled=busy||selected.size===0;
    $('calendar-submit').textContent=busy?'Preparing…':'Export selected';
    $<HTMLButtonElement>('calendar-select-all').disabled=busy||!choices.some(c=>!c.reason);
    $<HTMLButtonElement>('calendar-deselect-all').disabled=busy||selected.size===0;
    for(const input of $('calendar-items').querySelectorAll<HTMLInputElement>('input')){
      input.checked=selected.has(input.value);input.disabled=busy||!!choices.find(c=>c.row.id===input.value)?.reason;
    }
  }
  function open(itemId?:string){
    const plan=options.getPlan();if(!plan)return;
    attempt++;busy=false;clearReady();opened=plan;choices=calendarChoices(plan.items);selected.clear();
    for(const c of choices)if(!c.reason&&(!itemId||c.row.id===itemId))selected.add(c.row.id);
    $('calendar-error').textContent='';$('calendar-trip').textContent=plan.trip.payload.name;
    $('calendar-items').replaceChildren(...choices.map(choice=>{
      const {row,reason}=choice,item=row.payload,label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span');
      label.className='calendar-option';input.type='checkbox';input.value=row.id;
      const title=document.createElement('strong');title.textContent=item.title;
      const detail=document.createElement('small');detail.textContent=reason??(item.startDate+' · '+(item.startTime?(item.startTime+' '+item.timeZone):'All day — time not set'));
      copy.append(title,detail);label.append(input,copy);if(reason)label.classList.add('calendar-unavailable');
      input.onchange=()=>{if(input.checked)selected.add(row.id);else selected.delete(row.id);clearReady();$('calendar-error').textContent='';update();};
      return label;
    }));
    $('calendar-demo-note').hidden=!options.demo;update();dialog.showModal();
  }
  $('export-calendar').onclick=()=>open();
  $('calendar-select-all').onclick=()=>{for(const c of choices)if(!c.reason)selected.add(c.row.id);clearReady();update();};
  $('calendar-deselect-all').onclick=()=>{selected.clear();clearReady();update();};
  dialog.addEventListener('close',()=>{attempt++;busy=false;clearReady();opened=null;});
  form.onsubmit=event=>{
    event.preventDefault();if(busy||!opened||selected.size===0)return;
    const plan=opened,ids=[...selected],currentAttempt=++attempt;busy=true;clearReady();$('calendar-error').textContent='';update();
    void(async()=>{
      try{
        let prepared:Prepared;
        if(options.demo){
          blobUrl=URL.createObjectURL(new Blob([calendarFile(plan,ids)],{type:'text/calendar;charset=utf-8'}));
          prepared={url:blobUrl,eventCount:ids.length};
        }else prepared=await options.prepare(plan,ids);
        if(currentAttempt!==attempt)return;
        const current=options.getPlan();
        if(!current||current.trip.id!==plan.trip.id||current.revision!==plan.revision)throw Error('The itinerary changed. Close this dialog, refresh and export again.');
        const link=$<HTMLAnchorElement>('calendar-open'),download=$<HTMLAnchorElement>('calendar-download');
        // Use a fresh tap on an HTTP .ics link, matching the Apple device probe.
        link.href=prepared.url;download.href=options.demo?prepared.url:prepared.url+'?download=1';
        link.textContent=options.demo?'Open example calendar file':'Open in Apple Calendar';
        if(options.demo)download.download='example-itinerary.ics';else download.removeAttribute('download');
        $('calendar-ready-count').textContent=prepared.eventCount+' event'+(prepared.eventCount===1?'':'s')+' ready'+(prepared.expiresAt?' · link available for 2 minutes':'');
        $('calendar-ready').hidden=false;link.focus();
        if(prepared.expiresAt)expiryTimer=setTimeout(()=>{clearReady();$('calendar-error').textContent='The calendar link expired. Choose Export selected to prepare it again.';},Math.max(0,new Date(prepared.expiresAt).getTime()-Date.now()));
      }catch(error){if(currentAttempt===attempt)$('calendar-error').textContent=error instanceof Error?error.message:'Unable to export. Please try again.';}
      finally{if(currentAttempt===attempt){busy=false;update();}}
    })();
  };
  return {open,reset(){if(dialog.open)dialog.close();$('export-calendar').hidden=!options.getPlan();}};
}

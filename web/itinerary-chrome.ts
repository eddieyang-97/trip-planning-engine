// Keep phone navigation compact while retaining the same controls on desktop.
export function configureItineraryChrome(){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const phone=matchMedia('(max-width:700px)'),switcher=$<HTMLDetailsElement>('trip-switcher'),more=$<HTMLDetailsElement>('plan-more'),research=$<HTMLDetailsElement>('research-panel');
  let tripId:string|null=null;
  function researchDefault(){const url=new URL(location.href);return !phone.matches||url.searchParams.get('trip')===tripId&&(url.searchParams.has('stay')||url.searchParams.has('dining'));}
  function defaults(){switcher.open=!phone.matches;more.open=!phone.matches;research.open=researchDefault();}
  defaults();phone.addEventListener('change',defaults);
  $('trip-list').addEventListener('click',event=>{if(phone.matches&&(event.target as HTMLElement).closest('button'))switcher.open=false;});
  more.addEventListener('click',event=>{
    // Action handlers can disable their button before this click bubbles here.
    if(!phone.matches||!(event.target as HTMLElement).closest('button'))return;
    more.open=false;
    const returnFocus=()=>{if(phone.matches&&more.getClientRects().length)more.querySelector<HTMLElement>('summary')!.focus();};
    const dialog=document.querySelector<HTMLDialogElement>('dialog[open]');
    if(dialog)dialog.addEventListener('close',returnFocus,{once:true});else returnFocus();
  });
  document.addEventListener('click',event=>{if(phone.matches&&!more.contains(event.target as Node))more.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&phone.matches&&more.open){more.open=false;more.querySelector<HTMLElement>('summary')!.focus();}});
  // A comparison's existing direct-link/error disclosure must remain visible
  // even when the surrounding phone research section starts collapsed.
  research.addEventListener('toggle',event=>{
    const target=event.target as HTMLDetailsElement;
    if(target.open&&['stay-research','dining-research'].includes(target.parentElement?.id??''))research.open=true;
  },true);
  function researchSummary(){
    const labels=[['research','Flights'],['stay-research','Stays'],['dining-research','Dining']].filter(([id])=>!$(id!).hidden).map(([,label])=>label);
    $('research-summary').textContent=labels.join(' · ')||'Add options';
  }
  const observer=new MutationObserver(researchSummary);
  for(const id of ['research','stay-research','dining-research'])observer.observe($(id),{attributes:true,attributeFilter:['hidden']});
  return {update(next:{tripId:string|null;tripCount:number;status:string;researchAllowed:boolean;switching:boolean}){
    if(tripId!==next.tripId){tripId=next.tripId;research.open=researchDefault();if(phone.matches)more.open=false;}
    switcher.hidden=!next.switching;
    $('trip-switcher-count').textContent=`${next.tripCount} ${next.status==='all'?'total':next.status}`;
    research.hidden=!next.researchAllowed;researchSummary();
  }};
}

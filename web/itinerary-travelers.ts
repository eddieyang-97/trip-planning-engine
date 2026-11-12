import type {Traveler} from '../src/itinerary-travelers.js';

type Context={tripId:string;revision:number;owner:boolean;travelers:Traveler[]};
type Change={action:'add';name:string}|{action:'rename';id:string;name:string}|{action:'archive'|'restore';id:string};
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;

export function configureTravelers(save:(context:Context,change:Change)=>Promise<void>,onFilter:()=>void){
  const filter=byId<HTMLSelectElement>('traveler-filter');
  const manage=byId<HTMLButtonElement>('manage-travelers');
  const dialog=byId<HTMLDialogElement>('travelers-dialog');
  const form=byId<HTMLFormElement>('traveler-form');
  const name=byId<HTMLInputElement>('traveler-name');
  const submit=byId<HTMLButtonElement>('save-traveler');
  const cancel=byId<HTMLButtonElement>('cancel-traveler-rename');
  const error=byId('traveler-error');
  const choices=byId('item-traveler-choices');
  const assignment=byId<HTMLDetailsElement>('item-travelers');
  const roster=byId('traveler-list');
  let context:Context|null=null;
  let editing:{id:string;revision:number}|null=null;
  let saving=false;

  function label(traveler:Traveler){
    if(!traveler.name)return 'Archived traveler';
    const list=context!.travelers;
    const duplicate=list.some(other=>other.id!==traveler.id&&other.name.toLowerCase()===traveler.name.toLowerCase());
    const display=duplicate?`${traveler.name} (${list.indexOf(traveler)+1})`:traveler.name;
    return traveler.archived?`${display} · archived`:display;
  }
  function resetForm(){
    editing=null;form.reset();submit.textContent='Add traveler';cancel.hidden=true;
  }
  function action(text:string,person:string,run:()=>void){
    const button=document.createElement('button');
    button.type='button';button.className='subtle';button.textContent=text;
    button.setAttribute('aria-label',`${text} ${person}`);button.onclick=run;
    return button;
  }
  function renderRoster(){
    roster.replaceChildren();
    for(const traveler of context?.travelers??[]){
      const row=document.createElement('li'),title=document.createElement('strong'),actions=document.createElement('div');
      title.textContent=label(traveler);
      if(!traveler.archived)actions.append(action('Rename',title.textContent,()=>{
        editing={id:traveler.id,revision:context!.revision};name.value=traveler.name;
        submit.textContent='Save name';cancel.hidden=false;error.textContent='';name.focus();
      }));
      actions.append(action(traveler.archived?'Restore':'Archive',title.textContent,()=>{
        void apply({action:traveler.archived?'restore':'archive',id:traveler.id});
      }));
      row.append(title,actions);roster.append(row);
    }
    byId('travelers-empty').hidden=!!roster.childElementCount;
  }
  async function apply(change:Change,expectedRevision=context?.revision){
    if(!context?.owner||saving)return;
    const current={...context,revision:expectedRevision!};
    saving=true;error.textContent='';
    try{
      await save(current,change);
      if(context?.tripId!==current.tripId||!dialog.open)return;
      resetForm();name.focus();
    }catch(cause){
      if(context?.tripId===current.tripId&&dialog.open)error.textContent=cause instanceof Error?cause.message:'Unable to save the traveler.';
    }finally{saving=false;}
  }
  manage.onclick=()=>{resetForm();error.textContent='';renderRoster();dialog.showModal();name.focus();};
  cancel.onclick=()=>{resetForm();name.focus();};
  form.onsubmit=event=>{
    event.preventDefault();
    if(editing)void apply({action:'rename',id:editing.id,name:name.value},editing.revision);
    else void apply({action:'add',name:name.value});
  };
  filter.onchange=onFilter;

  return {
    update(next:Context|null){
      const selected=context?.tripId===next?.tripId?filter.value:'';
      context=next;
      manage.hidden=!next?.owner;
      if(!next?.owner&&dialog.open)dialog.close();
      if(!next){roster.replaceChildren();choices.replaceChildren();error.textContent='';resetForm();}
      const active=next?.travelers.filter(row=>!row.archived)??[];
      filter.replaceChildren(new Option('All travelers',''),...active.map(row=>new Option(label(row),row.id)));
      filter.value=active.some(row=>row.id===selected)?selected:'';
      filter.parentElement!.hidden=!active.length;
      if(dialog.open)renderRoster();
    },
    get selected(){return filter.value;},
    itemLabel(ids:string[]|undefined){
      if(!context||!ids?.length)return '';
      const labels=ids.map(id=>{const traveler=context!.travelers.find(row=>row.id===id);return traveler?label(traveler):'Archived traveler';});
      return `For ${labels.join(', ')}`;
    },
    openItem(ids:string[]|undefined){
      choices.replaceChildren();
      for(const traveler of context?.travelers??[]){
        if(traveler.archived&&!ids?.includes(traveler.id))continue;
        const option=document.createElement('label'),input=document.createElement('input'),caption=document.createElement('span');
        input.type='checkbox';input.value=traveler.id;input.checked=ids?.includes(traveler.id)??false;
        caption.textContent=label(traveler);option.append(input,caption);choices.append(option);
      }
      assignment.hidden=!choices.childElementCount;
      assignment.open=!!ids?.length;
    },
    itemValues(){
      if(assignment.hidden)return undefined;
      return [...choices.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value);
    },
  };
}

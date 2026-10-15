import type {MapLocation} from '../src/map-places.js';
export function configureMapEditor(root:HTMLElement,search:(query:string)=>Promise<MapLocation[]>){
  const $=<T extends HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
  const query=$<HTMLInputElement>('map-place-query'),find=$<HTMLButtonElement>('map-place-search'),results=$<HTMLDivElement>('map-place-results'),saved=$<HTMLDivElement>('map-place-saved'),status=$<HTMLParagraphElement>('map-place-status');
  let places:MapLocation[]=[],generation=0;
  function render(){
    saved.replaceChildren(...places.map((place,index)=>{
      const row=document.createElement('div');row.className='map-saved-place';const label=document.createElement('span');label.textContent=place.label;
      const remove=document.createElement('button');remove.type='button';remove.className='subtle';remove.textContent='Remove pin';remove.setAttribute('aria-label',`Remove pin ${place.label}`);remove.onclick=()=>{places.splice(index,1);render();};row.append(label,remove);return row;
    }));find.disabled=places.length>=2;query.disabled=places.length>=2;
  }
  find.onclick=async()=>{
    const text=query.value.trim();if(text.length<3){status.textContent='Enter at least 3 characters, including the town or country if needed.';return;}
    const current=++generation;find.disabled=true;status.textContent='Finding places…';results.replaceChildren();
    try{
      const found=await search(text);if(current!==generation)return;
      status.textContent=found.length?'Choose the correct place. It is saved only when you save this item.':'No places found. Try a more specific name and town.';
      results.replaceChildren(...found.map(place=>{
        const b=document.createElement('button');b.type='button';b.className='map-search-result';b.textContent=place.label;b.onclick=()=>{
          if(places.length>=2)return;
          if(!places.some(p=>p.latitude===place.latitude&&p.longitude===place.longitude))places.push(place);
          results.replaceChildren();query.value='';status.textContent='Pin added to this draft. Save the item to keep it.';render();
        };return b;
      }));
    }catch(error){if(current===generation)status.textContent=error instanceof Error?error.message:'Unable to search. Try again later.';}
    finally{if(current===generation)find.disabled=places.length>=2;}
  };
  query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(!find.disabled)find.click();}};
  return {
    set(values:MapLocation[]=[]){generation++;places=values.map(p=>({...p}));query.value='';results.replaceChildren();status.textContent='';render();},
    values:()=>places.map(p=>({...p})),
    focus(text:string){query.value=text;root.scrollIntoView({block:'nearest'});query.focus();},
    cancel(){generation++;results.replaceChildren();},
  };
}

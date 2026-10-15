import * as L from 'leaflet';
import type {LayoutRow} from './itinerary-layout.js';
import {mapDayItems,mapEntries,groupMapEntries} from './itinerary-map-data.js';
import {categories,itemCategory,itemNames as names,itemIcons} from './itinerary-categories.js';
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,action:()=>void,className='subtle'){const b=el('button',text,className);b.type='button';b.onclick=action;return b;}
export function configureMap(root:HTMLElement,open:(row:LayoutRow)=>void,locate:(row:LayoutRow)=>void){
  const heading=el('div','','map-heading'),copy=el('div');copy.append(el('h3','The places in your plan'),el('p','Choose a day or explore the whole trip. Shared pins group items at the same place; they do not describe a route.','muted'));
  const fit=button('Fit all pins',()=>fitPins());heading.append(copy,fit);
  const status=el('p','','field-hint');status.setAttribute('role','status');
  const grid=el('div','','map-layout'),canvas=el('div','','trip-map');canvas.setAttribute('aria-label','Interactive itinerary map');
  const list=el('div','','map-place-list');list.setAttribute('aria-label','Places in this view');
  const unavailable=el('p','','map-tile-message');unavailable.hidden=true;unavailable.setAttribute('role','status');
  const mapWrap=el('div','','map-canvas-wrap');mapWrap.append(canvas,unavailable);grid.append(mapWrap,list);
  const privacy=el('p','Map tiles are provided by OpenStreetMap. Opening this view requests the displayed map area; trip notes and sharing links are not sent.','field-hint');
  const licence=el('a','Map library licence');licence.href='/assets/leaflet-license.txt';licence.target='_blank';licence.rel='noopener noreferrer';privacy.append(document.createTextNode(' '),licence);
  const legend=el('ul','','map-legend');legend.setAttribute('aria-label','Map categories');
  for(const [key,category] of Object.entries(categories)){const label=el('li'),icon=el('span',category.icon,'category-symbol');icon.dataset.category=key;icon.setAttribute('aria-hidden','true');label.append(icon,document.createTextNode(category.label));legend.append(label);}
  const selection=el('p','','map-selection');selection.setAttribute('role','status');
  root.append(heading,legend,status,selection,grid,privacy);
  let map:L.Map|null=null,layer:L.LayerGroup|null=null,visible=false,sequence=0,rows:LayoutRow[]=[],day='all',canEdit=false;
  let bounds:L.LatLngTuple[]=[],markers=new Map<string,L.Marker>();
  let selectedKey:string|null=null;
  function select(key:string){
    selectedKey=key;const marker=markers.get(key),row=rows.find(r=>key.startsWith(`${r.id}:`));
    for(const current of new Set(markers.values())){const icon=current.getElement();icon?.classList.toggle('selected',current===marker);icon?.setAttribute('aria-pressed',String(current===marker));current.setZIndexOffset(current===marker?1000:0);}
    for(const card of list.querySelectorAll<HTMLElement>('[data-row]')){const active=card.dataset.row===row?.id;card.classList.toggle('selected',active);if(active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');}
    for(const place of list.querySelectorAll<HTMLButtonElement>('[data-pin]'))place.setAttribute('aria-pressed',String(place.dataset.pin===key));
    selection.textContent=row?`Selected: ${row.payload.title}`:'';
  }
  function fitPins(){if(!map||!bounds.length)return;map.invalidateSize();map.fitBounds(L.latLngBounds(bounds),{padding:[32,32],maxZoom:14,animate:false});}
  async function initialize(){
    if(map)return;
    map=L.map(canvas,{scrollWheelZoom:false,worldCopyJump:true}).setView([46.5,7],5);layer=L.layerGroup().addTo(map);
    draw();fitPins();
    const current=sequence;
    try{
      const response=await fetch('/itinerary/map-config',{credentials:'omit'});if(!response.ok)throw Error();
      const config=await response.json();if(current!==sequence||!map)return;
      const tiles=L.tileLayer(config.tileUrl,{maxZoom:19,minZoom:2,referrerPolicy:'origin',keepBuffer:1,attribution:''});
      // DOM text for configurable credit; only the fixed OSM attribution is a link.
      const credit=el('a',String(config.attribution));credit.href='https://www.openstreetmap.org/copyright';credit.target='_blank';credit.rel='noopener noreferrer';
      map.attributionControl.getContainer()?.append(credit);
      tiles.on('tileerror',()=>{unavailable.textContent='Some map tiles could not load. Saved places and their details are still available below.';unavailable.hidden=false;});
      tiles.addTo(map);
    }catch{unavailable.textContent='The background map could not load. You can still browse the saved places.';unavailable.hidden=false;}
    draw();
  }
  function draw(){
    if(!visible)return;
    const filtered=mapDayItems(rows,day),entries=mapEntries(filtered),unplaced=filtered.filter(r=>!entries.some(e=>e.row.id===r.id));
    canvas.hidden=!entries.length;
    status.textContent=`${filtered.length} ${filtered.length===1?'item':'items'} · ${entries.length} saved ${entries.length===1?'pin':'pins'} · ${unplaced.length} ${unplaced.length===1?'needs':'need'} a location${day==='all'?' · Whole trip':''}`;
    list.replaceChildren();layer?.clearLayers();markers.clear();bounds=[];fit.disabled=!entries.length;
    for(const group of groupMapEntries(entries)){
      const first=group[0]!,unique=[...new Set(group.map(e=>e.number))],numbers=unique.length>2?`${unique[0]} +${unique.length-1}`:unique.join(' · '),pin=el('span','','map-pin');
      const types=[...new Set(group.map(e=>itemCategory[e.row.payload.type]))];pin.dataset.category=types.length===1?types[0]!:'mixed';
      for(const type of types){const icon=el('span',categories[type].icon,'category-symbol');icon.dataset.category=type;icon.setAttribute('aria-hidden','true');pin.append(icon);}
      pin.append(el('span',numbers,'map-pin-number'));
      const width=Math.max(52,numbers.length*6+16+types.length*20);
      if(map&&layer){
        const label=group.map(e=>`${names[e.row.payload.type]}: ${e.row.payload.title}`).join('; ');
        const marker=L.marker([first.place.latitude,first.place.longitude],{icon:L.divIcon({html:pin,className:'itinerary-marker',iconSize:[width,40],iconAnchor:[width/2,40]}),title:label,alt:label,keyboard:true});
        const popup=el('div','','map-popup');
        for(const e of group){const part=el('div');part.append(el('strong',`${itemIcons[e.row.payload.type]} ${e.number}. ${e.row.payload.title}`),el('p',e.place.label),button('View item details',()=>open(e.row)));popup.append(part);markers.set(`${e.row.id}:${e.stop}`,marker);}
        marker.bindPopup(popup,{maxWidth:280});marker.addTo(layer);bounds.push([first.place.latitude,first.place.longitude]);
        // Leaflet opens popups on keyboard activation without emitting click.
        marker.on('popupopen',()=>select(`${first.row.id}:${first.stop}`));marker.getElement()?.setAttribute('aria-label',label);
      }
    }
    for(const [index,row] of filtered.entries()){
      const item=row.payload,card=el('article','','map-place-card');card.dataset.type=item.type;card.dataset.row=row.id;
      card.append(el('span',`${itemIcons[item.type]} ${names[item.type]} · ${item.startDate??'Date to confirm'}${item.startTime?` · ${item.startTime}`:''}`,'item-type'),el('h4',`${index+1}. ${item.title}`),el('span',item.status==='tentative'?'Tentative':'✓ Booked · reported by owner','map-booking'));
      const locations=entries.filter(e=>e.row.id===row.id);
      for(const entry of locations){const place=button(entry.place.label,()=>{
        const key=`${row.id}:${entry.stop}`,marker=markers.get(key);if(marker&&map){map.setView(marker.getLatLng(),Math.max(map.getZoom(),14),{animate:false});marker.openPopup();select(key);canvas.scrollIntoView({block:'nearest'});}
      },'map-place-link');place.dataset.pin=`${row.id}:${entry.stop}`;place.setAttribute('aria-pressed','false');place.setAttribute('aria-label',`Show ${entry.place.label} on map`);card.append(place);}
      if(!locations.length)card.append(el('p',item.location?`${item.location} · Not pinned yet`:'No saved location','field-hint'));
      const actions=el('div','','item-actions');actions.append(button('Details',()=>open(row)));
      if(canEdit)actions.append(button(locations.length?'Change pins':'Add map location',()=>locate(row)));
      card.append(actions);list.append(card);
    }
    if(!filtered.length)list.append(el('p','No items for this day. Choose another day or the whole trip.','muted'));
    if(!entries.length){unavailable.textContent=canEdit?'No saved pins in this view. Add a map location to an item to place it here.':'No saved pins in this view. The trip organizer can add map locations.';unavailable.hidden=false;}
    else unavailable.hidden=true;
    if(selectedKey&&markers.has(selectedKey))select(selectedKey);else{selectedKey=null;selection.textContent='';}
    requestAnimationFrame(fitPins);
  }
  return {
    update(next:LayoutRow[],editable:boolean){rows=next;canEdit=editable;if(visible)draw();},
    show(filter:string){visible=true;day=filter;if(!map&&mapEntries(mapDayItems(rows,day)).length)void initialize();else draw();},
    hide(){visible=false;map?.closePopup();},
    reset(){sequence++;visible=false;rows=[];selectedKey=null;selection.textContent='';list.replaceChildren();markers.clear();bounds=[];map?.remove();map=null;layer=null;unavailable.hidden=true;},
  };
}

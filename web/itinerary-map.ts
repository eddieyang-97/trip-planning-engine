import * as L from 'leaflet';
import type {LayoutRow} from './itinerary-layout.js';
import {mapDayItems,mapEntries,groupMapEntries,clusterMapGroups} from './itinerary-map-data.js';
import {categories,itemCategory,itemNames as names,itemIcons} from './itinerary-categories.js';
type Category=keyof typeof categories;
type LocationGroup=ReturnType<typeof groupMapEntries>[number];
const entryKey=(entry:LocationGroup[number])=>`${entry.row.id}:${entry.stop}`;
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function button(text:string,action:()=>void,className='subtle'){const b=el('button',text,className);b.type='button';b.onclick=action;return b;}
export function configureMap(root:HTMLElement,open:(row:LayoutRow)=>void,locate:(row:LayoutRow)=>void){
  const heading=el('div','','map-heading'),copy=el('div');copy.append(el('h3','The places in your plan'),el('p','Tap a pin for details. Circles group nearby locations; tap to zoom in.','muted'));
  const fit=button('Fit all pins',()=>fitPins());heading.append(copy,fit);
  const summary=el('div','','map-summary'),status=el('p','','field-hint');status.setAttribute('role','status');
  const missing=button('',()=>{onlyUnplaced=!onlyUnplaced;drawList();updateSummary();list.scrollIntoView({block:'nearest'});},'map-missing-filter');summary.append(status,missing);
  const grid=el('div','','map-layout'),canvas=el('div','','trip-map');canvas.setAttribute('aria-label','Interactive itinerary map');
  const list=el('div','','map-place-list');list.setAttribute('aria-label','Places in this view');
  const unavailable=el('p','','map-tile-message');unavailable.hidden=true;unavailable.setAttribute('role','status');
  const selectedCard=el('section','','map-selected-card');selectedCard.hidden=true;selectedCard.setAttribute('aria-label','Selected location');
  const selection=el('p','','map-selection');selection.setAttribute('role','status');
  const mapWrap=el('div','','map-canvas-wrap');mapWrap.append(canvas,unavailable,selection,selectedCard);grid.append(mapWrap,list);
  const privacy=el('p','Map tiles are provided by OpenStreetMap. Opening this view requests the displayed map area; trip notes and sharing links are not sent.','field-hint');
  const licence=el('a','Map library licence');licence.href='/assets/leaflet-license.txt';licence.target='_blank';licence.rel='noopener noreferrer';privacy.append(document.createTextNode(' '),licence);
  const filters=el('div','','map-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filter map categories');
  const filterButtons=new Map<'all'|Category,HTMLButtonElement>();
  for(const key of ['all',...Object.keys(categories)] as ('all'|Category)[]){
    const category=key==='all'?null:categories[key],b=button('',()=>{categoryFilter=key;onlyUnplaced=false;clearSelection();draw();},'map-filter');
    b.setAttribute('aria-pressed',String(key==='all'));
    if(category){b.dataset.category=key;const icon=el('span',category.icon,'map-filter-icon');icon.setAttribute('aria-hidden','true');b.append(icon);}
    b.append(document.createTextNode(category?.label??'All'));filters.append(b);filterButtons.set(key,b);
  }
  root.append(heading,filters,summary,grid,privacy);
  let map:L.Map|null=null,layer:L.LayerGroup|null=null,visible=false,sequence=0,rows:LayoutRow[]=[],day='all',canEdit=false;
  let categoryFilter:'all'|Category='all',onlyUnplaced=false,filtered:LayoutRow[]=[],entries:ReturnType<typeof mapEntries>=[],groups:LocationGroup[]=[];
  let bounds:L.LatLngTuple[]=[],markers=new Map<string,L.Marker>(),selectedKey:string|null=null,tileProblem='';
  function highlightSelection(){
    const marker=selectedKey?markers.get(selectedKey):undefined,rowId=entries.find(e=>entryKey(e)===selectedKey)?.row.id;
    for(const current of new Set(markers.values())){const icon=current.getElement();icon?.classList.toggle('selected',current===marker);icon?.setAttribute('aria-pressed',String(current===marker));current.setZIndexOffset(current===marker?1000:0);}
    for(const card of list.querySelectorAll<HTMLElement>('[data-row]')){const active=card.dataset.row===rowId;card.classList.toggle('selected',active);if(active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');}
    for(const place of list.querySelectorAll<HTMLButtonElement>('[data-pin]'))place.setAttribute('aria-pressed',String(place.dataset.pin===selectedKey));
  }
  function clearSelection(){selectedKey=null;selection.textContent='';selectedCard.replaceChildren();selectedCard.hidden=true;highlightSelection();}
  function select(chosen:LocationGroup[],key=entryKey(chosen[0]![0]!)){
    selectedKey=key;selectedCard.replaceChildren();selectedCard.hidden=false;
    const title=chosen.length===1?chosen[0]![0]!.place.label:`${chosen.length} nearby locations`;
    selection.textContent=`Selected: ${title}`;
    const header=el('div','','map-selected-heading');header.append(el('h4',title),button('Close',clearSelection));selectedCard.append(header);
    for(const group of chosen){
      const place=el('div','','map-selected-place');if(chosen.length>1)place.append(el('h5',group[0]!.place.label));
      for(const entry of group){
        const item=entry.row.payload,part=el('div','','map-selected-item');part.dataset.category=itemCategory[item.type];
        part.append(el('span',`${itemIcons[item.type]} ${names[item.type]}`,'item-type'),el('strong',item.title));
        if(item.startDate)part.append(el('p',`${item.startDate}${item.startTime?` · ${item.startTime}`:''}`,'field-hint'));
        part.append(button('View item details',()=>open(entry.row)));place.append(part);
      }
      selectedCard.append(place);
    }
    highlightSelection();
  }
  function fitPins(){if(!map||!bounds.length)return;map.invalidateSize();map.fitBounds(L.latLngBounds(bounds),{padding:[40,40],maxZoom:14,animate:false});}
  function position(place:LocationGroup[number]['place']):L.LatLngTuple{
    return [place.latitude,place.longitude+360*Math.round(((map?.getCenter().lng??place.longitude)-place.longitude)/360)];
  }
  function expand(cluster:LocationGroup[]){
    if(!map)return;
    const zoom=map.getZoom();
    if(zoom>=19){select(cluster);return;}
    map.fitBounds(L.latLngBounds(cluster.map(group=>position(group[0]!.place))),{padding:[52,52],maxZoom:19,animate:false});
    if(map.getZoom()<=zoom)map.setZoom(Math.min(19,zoom+1),{animate:false});
  }
  function drawMarkers(){
    if(!visible||!map||!layer)return;
    layer.clearLayers();markers.clear();
    const clusters=clusterMapGroups(groups,(latitude,longitude)=>map!.project(position({latitude,longitude,label:''}),map!.getZoom()));
    for(const cluster of clusters){
      const group=cluster[0]!,first=group[0]!,clustered=cluster.length>1,pin=el('span','','map-pin');
      const types=[...new Set(group.map(e=>itemCategory[e.row.payload.type]))];
      const category=clustered?'cluster':types.length===1?types[0]!:'mixed';pin.dataset.category=category;
      const icon=el('span',clustered?String(cluster.length):category==='mixed'?'⌖':categories[category as Category].icon,'map-pin-symbol');icon.setAttribute('aria-hidden','true');pin.append(icon);
      const points=cluster.map(g=>position(g[0]!.place)),point:L.LatLngTuple=[points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length];
      const label=clustered?`${cluster.length} nearby locations. ${map.getZoom()>=19?'Show places':'Zoom in'}.`:`${first.place.label}. ${group.map(e=>`${names[e.row.payload.type]}: ${e.row.payload.title}`).join('; ')}`;
      const marker=L.marker(point,{icon:L.divIcon({html:pin,className:'itinerary-marker',iconSize:[44,44],iconAnchor:[22,40]}),title:label,alt:label,keyboard:true,riseOnHover:true});
      const activate=()=>clustered?expand(cluster):select([group]);
      marker.on('click',activate);
      marker.on('keydown',(event:L.LeafletKeyboardEvent)=>{if(event.originalEvent.key==='Enter'||event.originalEvent.key===' '){L.DomEvent.stop(event.originalEvent);activate();}});
      marker.addTo(layer);marker.getElement()?.setAttribute('aria-label',label);
      for(const location of cluster)for(const entry of location)markers.set(entryKey(entry),marker);
    }
    highlightSelection();
  }
  async function initialize(){
    if(map)return;
    map=L.map(canvas,{scrollWheelZoom:false,worldCopyJump:true,minZoom:2,maxZoom:19}).setView([46.5,7],5);layer=L.layerGroup().addTo(map);
    map.on('zoomend resize',drawMarkers);draw();
    const current=sequence;
    try{
      const response=await fetch('/itinerary/map-config',{credentials:'omit'});if(!response.ok)throw Error();
      const config=await response.json();if(current!==sequence||!map)return;
      const tiles=L.tileLayer(config.tileUrl,{maxZoom:19,minZoom:2,referrerPolicy:'origin',keepBuffer:1,attribution:''});
      const credit=el('a',String(config.attribution));credit.href='https://www.openstreetmap.org/copyright';credit.target='_blank';credit.rel='noopener noreferrer';map.attributionControl.getContainer()?.append(credit);
      tiles.on('tileerror',()=>{tileProblem='Some map tiles could not load. Saved places and their details are still available below.';updateSummary();});tiles.addTo(map);
    }catch{if(current!==sequence||!map)return;tileProblem='The background map could not load. You can still browse the saved places.';updateSummary();}
  }
  function updateSummary(){
    const unplaced=filtered.filter(r=>!entries.some(e=>e.row.id===r.id));if(!unplaced.length)onlyUnplaced=false;
    status.textContent=`${groups.length} ${groups.length===1?'location':'locations'}${day==='all'?' · Whole trip':''}`;
    missing.hidden=!unplaced.length;missing.textContent=`${unplaced.length} ${unplaced.length===1?'item needs':'items need'} a location`;missing.setAttribute('aria-pressed',String(onlyUnplaced));
    for(const [key,b]of filterButtons)b.setAttribute('aria-pressed',String(key===categoryFilter));
    unavailable.textContent=!entries.length?(canEdit?'No saved locations in this view. Add a map location to an item below.':'No saved locations in this view. The trip organizer can add locations.'):tileProblem;
    unavailable.hidden=!unavailable.textContent;
  }
  function drawList(){
    list.replaceChildren();
    for(const row of filtered){
      const locations=entries.filter(e=>e.row.id===row.id);if(onlyUnplaced&&locations.length)continue;
      const item=row.payload,card=el('article','','map-place-card');card.dataset.type=item.type;card.dataset.row=row.id;
      card.append(el('span',`${itemIcons[item.type]} ${names[item.type]} · ${item.startDate??'Date to confirm'}${item.startTime?` · ${item.startTime}`:''}`,'item-type'),el('h4',item.title),el('span',item.status==='tentative'?'Tentative':'✓ Booked · reported by owner','map-booking'));
      for(const entry of locations){const place=button(entry.place.label,()=>{
        const key=entryKey(entry),group=groups.find(g=>g.some(e=>entryKey(e)===key));
        if(map&&group){map.setView(position(entry.place),Math.max(map.getZoom(),16),{animate:false});select([group],key);canvas.scrollIntoView({block:'nearest'});}
      },'map-place-link');place.dataset.pin=entryKey(entry);place.setAttribute('aria-pressed','false');place.setAttribute('aria-label',`Show ${entry.place.label} on map`);card.append(place);}
      if(!locations.length)card.append(el('p',item.location?`${item.location} · Not pinned yet`:'No saved location','field-hint'));
      const actions=el('div','','item-actions');actions.append(button('Details',()=>open(row)));if(canEdit)actions.append(button(locations.length?'Change pins':'Add map location',()=>locate(row)));card.append(actions);list.append(card);
    }
    if(!filtered.length)list.append(el('p','No items in this view. Choose another category or day.','muted'));
    highlightSelection();
  }
  function draw(){
    if(!visible)return;
    filtered=mapDayItems(rows,day).filter(row=>categoryFilter==='all'||itemCategory[row.payload.type]===categoryFilter);entries=mapEntries(filtered);groups=groupMapEntries(entries);
    if(selectedKey&&!entries.some(e=>entryKey(e)===selectedKey))clearSelection();
    else if(selectedKey){const group=groups.find(g=>g.some(e=>entryKey(e)===selectedKey));if(group)select([group],selectedKey);}
    if(!filtered.some(r=>!entries.some(e=>e.row.id===r.id)))onlyUnplaced=false;
    canvas.hidden=!entries.length;bounds=groups.map(group=>position(group[0]!.place));fit.disabled=!entries.length;
    updateSummary();drawList();drawMarkers();
    if(entries.length&&!map)void initialize();else requestAnimationFrame(()=>{if(visible)fitPins();});
  }
  return {
    update(next:LayoutRow[],editable:boolean){rows=next;canEdit=editable;if(visible)draw();},
    show(filter:string){visible=true;day=filter;draw();},
    hide(){visible=false;},
    reset(){sequence++;visible=false;rows=[];filtered=[];entries=[];groups=[];categoryFilter='all';onlyUnplaced=false;clearSelection();list.replaceChildren();markers.clear();bounds=[];map?.remove();map=null;layer=null;unavailable.hidden=true;tileProblem='';},
  };
}

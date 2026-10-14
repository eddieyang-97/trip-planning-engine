// Allowlist the shared projection: future private fields must not automatically
// become visible through either membership or account-free view links.
const fields=['type','title','startDate','startTime','endDate','endTime','timeZone','endTimeZone','location','url','notes','openQuestion','status'] as const;
export function sharedItinerary(trip:Record<string,any>,items:Record<string,any>[],role:'viewer'|'editor'='viewer'){
  const {name,destination,startDate,endDate,adults}=trip.payload;
  return {trip:{id:trip.id,payload:{name,destination,startDate,endDate,adults}},role,revision:trip.itinerary_revision,
    items:items.map(row=>({id:row.id,position:row.position,payload:{...Object.fromEntries(fields.map(key=>[key,row.payload[key]])) as Record<typeof fields[number],any>,bookingNote:''}})),
    history:[],research:{decisions:[],truncatedDecisions:false}};
}

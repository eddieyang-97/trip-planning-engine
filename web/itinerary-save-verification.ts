import type {MapLocation} from '../src/map-places.js';
export function verifyMapSave(requested:MapLocation[],result:{mapLocationCount?:number},saved:MapLocation[]){
  const matches=result.mapLocationCount===requested.length&&saved.length===requested.length&&requested.every((pin,index)=>{
    const actual=saved[index];return actual?.label===pin.label&&actual.latitude===pin.latitude&&actual.longitude===pin.longitude;
  });
  if(!matches)throw Error('The save response did not match the requested map pins. Review the refreshed item before retrying.');
}

// Only temporary read failures may keep an already-authorized on-screen plan.
// Unknown errors and access denials fail closed, including non-JSON responses.
export function temporaryReadError(message:string){return Object.assign(Error(message),{temporaryRead:true});}
export function isTemporaryReadError(error:unknown){return error instanceof Error&&'temporaryRead' in error&&error.temporaryRead===true;}
export async function readItineraryResponse(response:Response,fallback:string){
  const temporary=response.ok||response.status===408||response.status===429||response.status>=500;
  let result:any;
  try{result=await response.json();}
  catch{throw Object.assign(Error(fallback),{status:response.status,temporaryRead:temporary});}
  if(!response.ok)throw Object.assign(Error(result?.error??fallback),{status:response.status,code:result?.code,temporaryRead:temporary});
  return result;
}

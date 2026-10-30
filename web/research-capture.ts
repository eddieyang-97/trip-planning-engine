export function localDateTime(value:string){const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}
/** An untouched minute-resolution control must retain the exact recorded instant. */
export function captureTimestamp(value:string,previous:string|null|undefined){
  return previous&&value===localDateTime(previous)?previous:value?new Date(value).toISOString():null;
}
/** Optional fields remain in the form and in its readers when collapsed. */
export function captureSection(id:string,title:string,nodes:HTMLElement[],open=false){
  const section=document.createElement('details'),summary=document.createElement('summary');
  section.id=id;section.className='research-capture-section';section.open=open;
  summary.textContent=title;section.append(summary,...nodes);return section;
}
export function configureCaptureDialog(dialog:HTMLDialogElement,fields:HTMLElement){
  dialog.classList.add('research-capture');fields.classList.add('research-capture-fields');
  fields.addEventListener('invalid',event=>{
    for(let section=(event.target as HTMLElement).closest('details');section;section=section.parentElement?.closest('details')??null)section.open=true;
  },true);
  dialog.addEventListener('close',()=>{fields.scrollTop=0;});
}

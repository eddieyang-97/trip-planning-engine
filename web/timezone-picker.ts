import {timezoneChoices,searchTimezones,savedTimezoneChoice,type TimezoneChoice} from './timezones.js';
import {bindTimezoneOption} from './timezone-option.js';

export function timezonePicker(root:HTMLElement,choices:TimezoneChoice[]){
  const input=root.querySelector<HTMLInputElement>('[role=combobox]')!,value=root.querySelector<HTMLInputElement>('input[type=hidden]')!;
  const list=root.querySelector<HTMLElement>('[role=listbox]')!,hint=root.querySelector<HTMLElement>('[role=status]')!;
  let selected:TimezoneChoice|null=null,results:TimezoneChoice[]=[],active=-1,choosing=false;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
  function select(choice:TimezoneChoice|null){
    selected=choice;value.value=choice?.id??'';input.value=choice?.label??'';
    input.setCustomValidity('');input.removeAttribute('aria-invalid');
    hint.textContent=choice?`${choice.id} · Times stay local to this timezone.`:'Optional. Search by city, country or timezone.';close();
  }
  function highlight(index:number){
    active=index;const options=list.querySelectorAll<HTMLElement>('[role=option]');
    options.forEach((option,n)=>option.classList.toggle('highlighted',n===active));
    if(options[active]){input.setAttribute('aria-activedescendant',options[active]!.id);options[active]!.scrollIntoView({block:'nearest'});}
    else input.removeAttribute('aria-activedescendant');
  }
  function open(){
    const query=selected&&input.value===selected.label?'':input.value;
    results=searchTimezones(choices,query);const count=results.length;list.replaceChildren();active=-1;
    // A bounded panel stays usable on a phone; filtering can reach every zone.
    const displayed=results.slice(0,60);results=displayed;
    for(const [index,choice] of displayed.entries()){
      const option=document.createElement('div');option.id=`${input.id}-option-${index}`;option.role='option';
      option.setAttribute('aria-selected',String(choice.id===selected?.id));
      const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=choice.label;detail.textContent=choice.id;
      option.append(title,detail);
      bindTimezoneOption(option,{
        start:()=>{choosing=true;},
        choose:touch=>{
          // Commit any in-progress keyboard text before writing the selected label.
          if(touch)input.blur();
          select(choice);if(!touch)input.focus();close();
        },
        end:()=>{choosing=false;if(document.activeElement!==input)close();},
      });list.append(option);
    }
    hint.textContent=count?`${count} matching timezones${count>60?'; showing the first 60. Keep typing to narrow the list.':'. Use arrow keys and Enter to choose.'}`:'No matching timezone. Try a city or country, or clear the field if unknown.';
    if(!count){const empty=document.createElement('div');empty.className='timezone-no-results';empty.textContent='No matching timezone';list.append(empty);}
    list.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
  }
  input.onfocus=()=>{open();if(selected&&input.value===selected.label)input.select();};
  input.oninput=()=>{input.setCustomValidity('');input.removeAttribute('aria-invalid');open();};
  input.onblur=()=>{
    // A touch browser may blur between press and release. Keep the option alive
    // until that gesture either selects it or is cancelled by scrolling.
    if(choosing)return;
    close();const query=input.value.trim();
    if(!query)select(null);
    else if(selected&&query===selected.label)select(selected);
    else{const exact=choices.find(choice=>choice.id.toLowerCase()===query.toLowerCase()||choice.label.toLowerCase()===query.toLowerCase());if(exact)select(exact);}
  };
  input.onkeydown=event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(list.hidden)open();
      highlight(event.key==='ArrowDown'?Math.min(active+1,results.length-1):active<0?results.length-1:Math.max(0,active-1));
    }else if(event.key==='Enter'&&!list.hidden&&active>=0){event.preventDefault();select(results[active]!);}
    else if(event.key==='Enter'&&!list.hidden&&results.length===1){event.preventDefault();select(results[0]!);}
    else if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();}
    else if(event.key==='Tab')close();
  };
  return {
    setValue(id:string|null){select(id?savedTimezoneChoice(choices,id):null);},
    validate(){
      const query=input.value.trim();if(!query){select(null);return;}
      if(selected&&query===selected.label)return;
      const exact=choices.find(choice=>choice.id.toLowerCase()===query.toLowerCase()||choice.label.toLowerCase()===query.toLowerCase());
      if(exact){select(exact);return;}
      const message=`Choose a ${value.name==='timeZone'?'start':'end'} timezone from the results, or clear it if unknown.`;
      input.focus();input.setCustomValidity(message);input.setAttribute('aria-invalid','true');throw Error(message);
    },
  };
}
export function configureTimezonePickers(form:HTMLFormElement){
  const choices=timezoneChoices(),pickers=[...form.querySelectorAll<HTMLElement>('.timezone-picker')].map(root=>({
    name:root.querySelector<HTMLInputElement>('input[type=hidden]')!.name,picker:timezonePicker(root,choices),
  }));
  return {
    setValues(values:{timeZone:string|null;endTimeZone:string|null}){for(const {name,picker} of pickers)picker.setValue(values[name as keyof typeof values]);},
    validate(){for(const {picker} of pickers)picker.validate();},
  };
}

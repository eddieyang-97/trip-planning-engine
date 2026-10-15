// Keep selection independent of a later click/blur sequence on touch browsers.
// EventTarget also lets regression tests replay pointer sequences without a DOM shim.
export function bindTimezoneOption(target:EventTarget,actions:{start:()=>void;choose:(touch:boolean)=>void;end:()=>void}){
  let pointer:{id:number;x:number;y:number;type:string;moved:boolean}|null=null;
  let handledAt=-Infinity;
  target.addEventListener('pointerdown',raw=>{
    const event=raw as PointerEvent;if(!event.isPrimary||event.button!==0)return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,type:event.pointerType,moved:false};
    actions.start();event.preventDefault();
  });
  target.addEventListener('pointermove',raw=>{
    const event=raw as PointerEvent;if(!pointer||pointer.id!==event.pointerId)return;
    if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>10)pointer.moved=true;
  });
  target.addEventListener('pointerup',raw=>{
    const event=raw as PointerEvent;if(!pointer||pointer.id!==event.pointerId)return;
    const gesture=pointer;pointer=null;handledAt=event.timeStamp;
    try{
      if(!gesture.moved&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<=10){
        event.preventDefault();actions.choose(gesture.type==='touch'||gesture.type==='pen');
      }
    }finally{actions.end();}
  });
  const cancel=(raw:Event)=>{
    const event=raw as PointerEvent;if(!pointer||pointer.id!==event.pointerId)return;
    pointer=null;handledAt=event.timeStamp;actions.end();
  };
  target.addEventListener('pointercancel',cancel);
  target.addEventListener('pointerleave',raw=>{if(pointer?.type==='mouse')cancel(raw);});
  target.addEventListener('click',raw=>{
    const event=raw as MouseEvent;event.preventDefault();
    // Some browsers emit a compatibility click after release; select only once.
    // A keyboard/assistive activation (detail 0) remains available independently.
    if(event.detail>0&&event.timeStamp-handledAt>=0&&event.timeStamp-handledAt<750)return;
    actions.choose(false);
  });
}

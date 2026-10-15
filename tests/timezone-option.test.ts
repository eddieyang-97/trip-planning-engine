import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindTimezoneOption} from '../web/timezone-option.js';

function fixture(){
  const target=new EventTarget(),chosen:boolean[]=[],order:string[]=[];
  bindTimezoneOption(target,{start:()=>order.push('press'),choose:touch=>{chosen.push(touch);order.push('choose');},end:()=>order.push('end')});
  const send=(type:string,extra:Record<string,unknown>={})=>{
    const event=new Event(type,{cancelable:true});
    Object.defineProperties(event,Object.fromEntries(Object.entries({pointerId:1,isPrimary:true,button:0,pointerType:'touch',clientX:20,clientY:20,detail:1,...extra}).map(([key,value])=>[key,{value}])));
    target.dispatchEvent(event);return event;
  };
  return {chosen,order,send};
}

test('touch release selects without a later click and suppresses the duplicate click',()=>{
  const f=fixture();assert.equal(f.send('pointerdown').defaultPrevented,true);
  assert.deepEqual(f.chosen,[],'press alone must not select while the user might scroll');
  assert.deepEqual(f.order,['press']);
  f.send('pointerup');assert.deepEqual(f.chosen,[true]);assert.deepEqual(f.order,['press','choose','end']);
  f.send('click');assert.deepEqual(f.chosen,[true],'compatibility click must not reopen or select twice');
  f.send('click',{detail:0});assert.deepEqual(f.chosen,[true,false],'assistive activation still works after touch');
});

test('scrolling, cancellation, foreign pointers and secondary buttons never select a timezone',()=>{
  for(const interrupted of ['pointermove','pointercancel'] as const){
    const f=fixture();f.send('pointerdown');f.send(interrupted,{clientY:50});f.send('pointerup',{clientY:50});f.send('click');
    assert.deepEqual(f.chosen,[]);assert.equal(f.order.at(-1),'end');
  }
  const f=fixture();f.send('pointerdown',{button:2});f.send('pointerup');assert.deepEqual(f.chosen,[]);
  f.send('pointerdown');f.send('pointerup',{pointerId:2});assert.deepEqual(f.chosen,[]);f.send('pointercancel');
});

test('mouse release selects once, dragging outside cancels, and click-only activation remains supported',()=>{
  const f=fixture();f.send('pointerdown',{pointerType:'mouse'});f.send('pointerup',{pointerType:'mouse'});f.send('click');assert.deepEqual(f.chosen,[false]);
  const outside=fixture();outside.send('pointerdown',{pointerType:'mouse'});outside.send('pointerleave',{pointerType:'mouse'});outside.send('pointerup',{pointerType:'mouse'});assert.deepEqual(outside.chosen,[]);assert.equal(outside.order.at(-1),'end');
  const clickOnly=fixture();clickOnly.send('click');assert.deepEqual(clickOnly.chosen,[false]);
});

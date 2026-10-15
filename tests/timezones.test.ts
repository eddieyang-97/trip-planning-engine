import assert from 'node:assert/strict';
import {test} from 'node:test';
import {timezoneChoices,searchTimezones,savedTimezoneChoice} from '../web/timezones.js';

test('timezone search finds countries, destination aliases and IANA names without collapsing distinct local rules',()=>{
  const choices=timezoneChoices();
  assert.ok(choices.length>400);
  assert.ok(searchTimezones(choices,'rome italy').some(c=>c.id==='Europe/Rome'&&c.label==='Rome — Italy'));
  assert.ok(searchTimezones(choices,'Turin').some(c=>c.id==='Europe/Rome'));
  assert.equal(searchTimezones(choices,'alba')[0]?.id,'Europe/Rome');
  assert.ok(searchTimezones(choices,'Geneva').some(c=>c.id==='Europe/Zurich'));
  assert.ok(searchTimezones(choices,'Europe/London').some(c=>c.id==='Europe/London'));
  assert.ok(searchTimezones(choices,'new york').some(c=>c.id==='America/New_York'));
  assert.ok(searchTimezones(choices,'UTC').some(c=>c.id==='UTC'));
  assert.deepEqual(searchTimezones(choices,'This is not a timezone'),[]);
  assert.ok(choices.some(c=>c.id==='America/Phoenix'));assert.ok(choices.some(c=>c.id==='America/Denver'));
  assert.equal(new Set(choices.map(c=>c.id)).size,choices.length);
});

test('saved IDs and unknown future names survive editing; identifiers retain seasonal clock rules',()=>{
  const choices=timezoneChoices();
  assert.equal(savedTimezoneChoice(choices,'Europe/Rome').id,'Europe/Rome');
  const legacy=savedTimezoneChoice(choices,'US/Eastern');assert.equal(legacy.id,'US/Eastern');assert.match(legacy.label,/New York/);
  assert.equal(savedTimezoneChoice(choices,'Future/Place').id,'Future/Place');
  const offset=(date:string)=>new Intl.DateTimeFormat('en',{timeZone:savedTimezoneChoice(choices,'Europe/Rome').id,timeZoneName:'shortOffset'}).formatToParts(new Date(date)).find(p=>p.type==='timeZoneName')!.value;
  assert.equal(offset('2026-01-15T12:00:00Z'),'GMT+1');assert.equal(offset('2026-07-15T12:00:00Z'),'GMT+2');
});

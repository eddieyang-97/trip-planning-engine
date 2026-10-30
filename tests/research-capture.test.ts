import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureTimestamp,localDateTime} from '../web/research-capture.js';

test('research timestamp controls preserve unedited seconds, precision and recorded offsets',()=>{
  for(const previous of ['2026-10-24T12:15:39.456Z','2026-12-25T18:12:37+01:00']){
    assert.equal(captureTimestamp(localDateTime(previous),previous),previous);
    assert.equal(captureTimestamp('',previous),null);
    const changed='2026-10-25T09:23';assert.equal(captureTimestamp(changed,previous),new Date(changed).toISOString());
  }
  assert.equal(captureTimestamp('',null),null);
  assert.equal(captureTimestamp('2026-10-25T09:23',null),new Date('2026-10-25T09:23').toISOString());
});

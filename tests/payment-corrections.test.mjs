import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentCorrection} from '../src/payment-corrections.js';
const before={member_id:'a',month:'2026-10',paid_at:'2026-10-11',cents:4000,method:'cash'};
test('valid correction preserves before/after with reason',()=>{const r=validatePaymentCorrection({...before,cents:3500,reason:'Pogresan iznos uplate'},before);assert.equal(r.before.cents,4000);assert.equal(r.after.cents,3500)});
test('rejects missing or short reason',()=>assert.throws(()=>validatePaymentCorrection({...before,cents:3000,reason:'kratko'},before),/Razlog/));
test('rejects no change',()=>assert.throws(()=>validatePaymentCorrection({...before,reason:'Dovoljno dug razlog'},before),/promijenjen/));
test('rejects invalid monetary/date values',()=>{for(const change of [{cents:0},{cents:3.4},{month:'2026-13'},{paid_at:'2026-02-30'}])assert.throws(()=>validatePaymentCorrection({...before,...change,reason:'Dovoljno dug razlog'},before))});

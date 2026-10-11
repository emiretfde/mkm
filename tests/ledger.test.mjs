import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLedger} from '../src/ledger.js';
const c=(month,cents,member_id='a')=>({member_id,month,cents});
test('excess from October automatically pays November',()=>{
 const charges=[c('2026-10',3500),c('2026-11',3500)];
 const payments=[c('2026-10',5000)];
 const oct=buildLedger(charges,payments,'2026-10');
 assert.equal(oct.rows[0].credit,1500);assert.equal(oct.totals.debt,0);
 const nov=buildLedger(charges,payments,'2026-11');
 assert.equal(nov.rows[0].debt,2000);assert.equal(nov.rows[0].credit,0);
});
test('payments do not cross member boundaries',()=>{
 const l=buildLedger([c('2026-10',4000,'a'),c('2026-10',3500,'b')],[c('2026-10',6000,'a')],'2026-10');
 assert.equal(l.totals.debt,3500);assert.equal(l.totals.credit,2000);
});
test('free membership with existing paid amount yields credit',()=>{
 const l=buildLedger([c('2026-10',0)],[c('2026-10',3000)],'2026-10');assert.equal(l.totals.credit,3000);
});
test('later payments cannot affect earlier months',()=>{
 const l=buildLedger([c('2026-10',4000)],[c('2026-11',4000)],'2026-10');assert.equal(l.totals.debt,4000);
});
test('old debt is repaid before credit',()=>{
 const l=buildLedger([c('2026-09',4000),c('2026-10',4000)],[c('2026-10',5000)],'2026-10');assert.equal(l.totals.debt,3000);
});

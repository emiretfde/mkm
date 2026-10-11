import test from 'node:test';
import assert from 'node:assert/strict';
import {groupBalances,paymentHistory,csvText} from '../public/reports.js';
const groups=[{id:'g1',name:'Mladji'},{id:'g2',name:'Stariji'}];
const members=[{id:'a',name:'A',group_id:'g1',active:1},{id:'b',name:'B',group_id:'g1',active:0},{id:'c',name:'C',group_id:'g2',active:1}];
const ledger=[{member_id:'a',paid:1000,debt:1000,credit:0},{member_id:'b',paid:0,debt:0,credit:1000},{member_id:'c',paid:500,debt:500,credit:0}];
test('balances per group do not offset one member credit against another debt',()=>{
 const r=groupBalances(groups,members,ledger,[{member_id:'a',cents:2000},{member_id:'b',cents:0},{member_id:'c',cents:1000}]);
 assert.deepEqual(r.map(x=>[x.charged,x.paid,x.debt,x.credit,x.members]),[[2000,1000,1000,1000,1],[1000,500,500,0,1]]);
});
test('payment history filters by member and month',()=>{
 const payments=[{id:'1',member_id:'a',month:'2026-09',paid_at:'2026-09-10',cents:100},{id:'2',member_id:'a',month:'2026-10',paid_at:'2026-10-11',cents:200},{id:'3',member_id:'c',month:'2026-10',paid_at:'2026-10-12',cents:300}];
 assert.deepEqual(paymentHistory(payments,members,groups,{memberId:'a',month:'2026-10'}).map(p=>p.id),['2']);
 assert.deepEqual(paymentHistory(payments,members,groups,{}).map(p=>p.id),['3','2','1']);
});
test('CSV output escapes quotes, separators and adds Excel BOM',()=>{
 const text=csvText([{name:'A; "B"',cents:4000}],[['Name','name'],['Cents','cents']]);
 assert.ok(text.startsWith('\ufeff'));assert.ok(text.includes('"A; ""B""";"4000"'));
});

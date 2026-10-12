import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function database(role) {
  const rows = {
    groups: [{id:'assigned',name:'Testna grupa'},{id:'other',name:'Druga grupa'}],
    members: [{id:'test-member',group_id:'assigned',name:'Testni zapis',active:1,parent_phone:'test-contact',fee_exempt:1,fee_note:'test-finance-note',family_id:'test-family'},
              {id:'other-member',group_id:'other',name:'Nedodijeljeni zapis',active:1}],
    sessions: [],attendance: []
  };
  return {prepare(sql){return {bind(){return this;},async first(){
    if(sql.includes('FROM auth_sessions'))return {id:'test-coach',role,display_name:'Testni nalog'};
    throw new Error('Unexpected query: '+sql);
  },async all(){
    if(sql.includes('FROM coach_groups'))return {results:[{group_id:'assigned'}]};
    const table=Object.keys(rows).find(key=>(sql.includes('FROM '+key+' ')||sql.endsWith('FROM '+key)));
    if(table)return {results:rows[table]};
    throw new Error('Unexpected query: '+sql);
  }}}};
}

test('coach dashboard omits financial fields and unassigned members', async () => {
  const request=new Request('https://mkm.test/api/dashboard',{headers:{Cookie:'mkm_session='+'a'.repeat(64)}});
  const response=await worker.fetch(request,{DB:database('coach')});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.members.length,1);
  assert.equal(data.members[0].id,'test-member');
  for(const field of ['parent_phone','fee_exempt','fee_note','family_id']) assert.equal(field in data.members[0],false);
  for(const field of ['payments','ledger','charges','families','corrections','monthlyFeeCents','users','links']) assert.equal(field in data,false);
});

test('coach cannot record a payment through the backend', async () => {
  const request=new Request('https://mkm.test/api/payments',{method:'POST',headers:{Cookie:'mkm_session='+'a'.repeat(64),'Content-Type':'application/json'},body:'{}'});
  const response=await worker.fetch(request,{DB:database('coach')});
  assert.equal(response.status,403);
});

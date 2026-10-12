import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../src/worker.js';

// Real schema and SQL, isolated in memory; never connects to Cloudflare.
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
 const db={
  prepare(sql){let values=[];return {bind(...args){values=args;return this;},
   async first(){return sqlite.prepare(sql).get(...values)||null;},
   async all(){return {results:sqlite.prepare(sql).all(...values)};},
   async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}
  };},
  async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 };
 for(const role of ['admin','coach']){
  sqlite.prepare('INSERT INTO users(id,email,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)').run(role,role+'@test.invalid','Test '+role,role,'00','00');
  const token=(role==='admin'?'a':'b').repeat(64);
  sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),role,Math.floor(Date.now()/1000)+3600);
 }
 async function request(path,body,role='admin',method=body===undefined?'GET':'POST'){
  return worker.fetch(new Request('https://mkm.test/api/'+path,{method,headers:{Cookie:'mkm_session='+(role==='admin'?'a':'b').repeat(64),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db});
 }
 async function create(path,body){const r=await request(path,body);assert.equal(r.status,201,await r.clone().text());return (await r.json()).id;}
 return {sqlite,request,create};
}
test('real SQL fee generation applies 40 / 70 / 105 euros, exemptions and frozen charges',async t=>{
 const {sqlite,request,create}=fixture(t);
 const group=await create('groups',{name:'TEST grupa'});
 const members=[];
 for(const count of [1,2,3]){
  const family=await create('families',{name:'TEST porodica '+count});
  for(let i=0;i<count;i++)members.push({id:await create('members',{name:'TEST zapis '+count+'-'+i,group_id:group,gender:'boy',family_id:family}),cents:count===1?4000:3500});
 }
 for(const gender of ['girl','boy']) members.push({id:await create('members',{name:'TEST besplatni '+gender,group_id:group,gender,fee_exempt:gender==='boy'}),cents:0});
 const r=await request('fees/generate',{month:'2026-10'});assert.equal(r.status,201);
 const rows=sqlite.prepare('SELECT member_id,cents FROM fee_charges').all();
 assert.equal(rows.length,8);
 for(const m of members)assert.equal(rows.find(x=>x.member_id===m.id).cents,m.cents);
 const before=sqlite.prepare('SELECT * FROM fee_charges ORDER BY id').all();
 assert.equal((await request('fees/generate',{month:'2026-10'})).status,409);
 assert.deepEqual(sqlite.prepare('SELECT * FROM fee_charges ORDER BY id').all(),before);
});
test('real SQL payment workflow carries credit, isolates members and preserves correction history',async t=>{
 const {sqlite,request,create}=fixture(t);
 const group=await create('groups',{name:'TEST grupa'});
 const first=await create('members',{name:'TEST zapis A',group_id:group,gender:'boy'});
 const second=await create('members',{name:'TEST zapis B',group_id:group,gender:'boy'});
 for(const month of ['2026-10','2026-11'])assert.equal((await request('fees/generate',{month})).status,201);
 const charges=sqlite.prepare('SELECT * FROM fee_charges ORDER BY id').all();
 const payment=await create('payments',{member_id:first,month:'2026-10',paid_at:'2026-10-10',cents:10000,method:'cash'});
 let dash=await (await request('dashboard?month=2026-11')).json();
 assert.equal(dash.ledger.rows.find(x=>x.member_id===first).credit,2000);
 assert.equal(dash.ledger.rows.find(x=>x.member_id===second).debt,8000);
 const change={member_id:first,month:'2026-10',paid_at:'2026-10-10',cents:9050,method:'cash',reason:'TEST ispravka unosa'};
 assert.equal((await request('payments/'+payment,change,'admin','PATCH')).status,200);
 const history=sqlite.prepare('SELECT * FROM payment_corrections').all();
 assert.equal(history.length,1);assert.equal(JSON.parse(history[0].before_json).cents,10000);assert.equal(JSON.parse(history[0].after_json).cents,9050);
 dash=await (await request('dashboard?month=2026-11')).json();
 assert.equal(dash.ledger.rows.find(x=>x.member_id===first).credit,1050);
 assert.equal(dash.ledger.rows.find(x=>x.member_id===second).debt,8000);
 assert.equal((await request('payments/'+payment,{...change,cents:8000,reason:''},'admin','PATCH')).status,400);
 assert.equal(sqlite.prepare('SELECT cents FROM payments WHERE id=?').get(payment).cents,9050);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM payment_corrections').get().n,1);
 assert.deepEqual(sqlite.prepare('SELECT * FROM fee_charges ORDER BY id').all(),charges);
});
test('real SQL coach scope protects other groups and all administrative writes',async t=>{
 const {sqlite,request,create}=fixture(t);
 const assigned=await create('groups',{name:'TEST dodijeljena'});
 const other=await create('groups',{name:'TEST druga'});
 sqlite.prepare('INSERT INTO coach_groups(user_id,group_id) VALUES(?,?)').run('coach',assigned);
 const own=await create('members',{name:'TEST svoj zapis',group_id:assigned,gender:'boy'});
 const foreign=await create('members',{name:'TEST drugi zapis',group_id:other,gender:'girl'});
 const dates={issued_on:'2026-10-01',expires_on:'2027-10-01'};
 assert.equal((await request('certificates',{member_id:own,...dates},'coach')).status,201);
 assert.equal((await request('certificates',{member_id:foreign,...dates},'coach')).status,403);
 await create('certificates',{member_id:foreign,...dates});
 const certs=await (await request('certificates',undefined,'coach')).json();
 assert.deepEqual(certs.certificates.map(c=>c.member_id),[own]);
 assert.equal((await request('certificates',{member_id:own,issued_on:'2026-11-01',expires_on:'2027-11-01'},'coach')).status,201);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM medical_certificates WHERE member_id=? AND archived_at IS NULL').get(own).n,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM medical_certificates WHERE member_id=? AND archived_at IS NOT NULL').get(own).n,1);
 for(const path of ['groups','families','members','payments','fees/generate','sessions','users','settings'])assert.equal((await request(path,{},'coach')).status,403,path);
 assert.equal((await request('members/'+own,{},'coach','PATCH')).status,403);
 assert.equal((await request('payments/test',{},'coach','PATCH')).status,403);
});

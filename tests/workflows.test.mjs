import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../src/worker.js';
import {deliverPush} from '../src/announcements.js';
import {currentFeeMonth} from '../src/simple-fees.js';

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
  return worker.fetch(new Request('https://mkm.test/api/'+path,{method,headers:{Cookie:role?'mkm_session='+(role==='admin'?'a':'b').repeat(64):'',Origin:'https://mkm.test','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db});
 }
 async function create(path,body){const r=await request(path,body);assert.equal(r.status,201,await r.clone().text());return (await r.json()).id;}
 return {sqlite,db,request,create};
}
test('real SQL fee generation applies uniform 40 euros, free girls and preserves frozen charges',async t=>{
 const {sqlite,request,create}=fixture(t);
 const group=await create('groups',{name:'TEST grupa'});
 const members=[];
 for(const count of [1,2,3]){
  const family=await create('families',{name:'TEST porodica '+count});
  for(let i=0;i<count;i++)members.push({id:await create('members',{name:'TEST zapis '+count+'-'+i,group_id:group,gender:'boy',family_id:family}),cents:4000});
 }
 for(const gender of ['girl','boy']) members.push({id:await create('members',{name:'TEST besplatni '+gender,group_id:group,gender,fee_exempt:gender==='boy'}),cents:gender==='girl'?0:4000});
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

test('announcements keep private posts out of public feed and enforce coach group scope',async t=>{
 const {sqlite,request,create}=fixture(t);
 const own=await create('groups',{name:'TEST grupa A'}),other=await create('groups',{name:'TEST grupa B'});
 sqlite.prepare('INSERT INTO coach_groups(user_id,group_id) VALUES(?,?)').run('coach',own);
 const post={title:'TEST trening',body:'TEST klupsko obavještenje',visibility:'public',group_id:own,notify:false};
 assert.equal((await request('announcements',post,null)).status,401);
 assert.equal((await request('announcements',{...post,group_id:other},'coach')).status,403);
 assert.equal((await request('announcements',{...post,group_id:''},'coach')).status,403);
 const publicId=await create('announcements',post);
 const privateId=await create('announcements',{...post,title:'TEST interno',visibility:'users',group_id:other});
 const globalId=await create('announcements',{...post,title:'TEST za sve naloge',visibility:'users',group_id:''});
 const publicFeed=await (await request('public/announcements',undefined,null)).json();
 assert.deepEqual(publicFeed.announcements.map(a=>a.id),[publicId]);
 for(const row of publicFeed.announcements)assert.deepEqual(Object.keys(row).sort(),['id','title','body','created_at','group_name'].sort());
 const coachFeed=await (await request('announcements',undefined,'coach')).json();
 assert(coachFeed.announcements.some(a=>a.id===globalId));assert(!coachFeed.announcements.some(a=>a.id===privateId));
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM push_deliveries').get().n,0);
 assert.equal((await request('announcements',{...post,title:'x'.repeat(121)})).status,400);
});

test('push subscription ownership, public config and notification recipients are protected',async t=>{
 const {sqlite,request,create}=fixture(t);
 const own=await create('groups',{name:'TEST grupa A'}),other=await create('groups',{name:'TEST grupa B'});
 sqlite.prepare('INSERT INTO coach_groups(user_id,group_id) VALUES(?,?)').run('coach',own);
 const config=await (await request('push/config',undefined,null)).json();
 assert.deepEqual(Object.keys(config),['publicKey']);assert.equal(config.publicKey.length,87);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const raw=await crypto.subtle.exportKey('raw',pair.publicKey);
 const p256dh=Buffer.from(raw).toString('base64url'),auth=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
 const sub=i=>({endpoint:'https://fcm.googleapis.com/fcm/send/TEST'+i,keys:{p256dh,auth}});
 const payload=(i,token)=>({subscription:sub(i),device_token:token.repeat(43)});
 assert.equal((await request('push/subscriptions',payload(1,'x'),null)).status,201);
 assert.equal((await request('push/subscriptions',payload(1,'y'),null)).status,409);
 assert.equal((await request('push/subscriptions',payload(2,'z'),'coach')).status,201);
 assert.equal((await request('push/subscriptions',payload(3,'w'),'admin')).status,201);
 for(const endpoint of ['http://127.0.0.1/push','https://evil.example/push','https://fcm.googleapis.com.evil.example/push'])assert.equal((await request('push/subscriptions',{...payload(4,'v'),subscription:{...sub(4),endpoint}},null)).status,400);
 const post={title:'TEST novost',body:'TEST tekst',visibility:'users',group_id:other,notify:true};
 const id=await create('announcements',post);
 const recipients=sqlite.prepare('SELECT s.user_id FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE announcement_id=?').all(id);
 assert.deepEqual(recipients.map(s=>s.user_id),['admin']);
 const pubId=await create('announcements',{...post,visibility:'public'});
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM push_deliveries WHERE announcement_id=?').get(pubId).n,3);
 assert.equal((await request('push/subscriptions',{endpoint:sub(1).endpoint,device_token:'y'.repeat(43)},null,'DELETE')).status,200);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n,3);
 assert.equal((await request('push/subscriptions',{endpoint:sub(1).endpoint,device_token:'x'.repeat(43)},null,'DELETE')).status,200);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n,2);
});

test('push deliveries encrypt notifications, retry failures and revoke gone devices',async t=>{
 const {sqlite,db,request,create}=fixture(t);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const raw=await crypto.subtle.exportKey('raw',pair.publicKey),p256dh=Buffer.from(raw).toString('base64url'),auth=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
 for(let i=0;i<3;i++)assert.equal((await request('push/subscriptions',{device_token:String(i).repeat(43),subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/TEST'+i,keys:{p256dh,auth}}},null)).status,201);
 const id=await create('announcements',{title:'TEST public',body:'TEST tekst',visibility:'public',notify:true});
 const calls=[];
 t.mock.method(globalThis,'fetch',async (endpoint,options)=>{
  calls.push({endpoint,options});
  assert.equal(options.headers['content-encoding'],'aes128gcm');
  assert.match(options.headers.authorization,/^vapid /);
  assert(!Buffer.from(options.body).toString().includes('TEST tekst'));
  return new Response(null,{status:endpoint.endsWith('0')?201:endpoint.endsWith('1')?503:410});
 });
 await deliverPush({DB:db},'https://mkm.test');
 assert.equal(calls.length,3);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM push_deliveries WHERE announcement_id=? AND status='sent'").get(id).n,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM push_deliveries WHERE announcement_id=? AND status='queued' AND next_attempt>0").get(id).n,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n,2);
 await deliverPush({DB:db},'https://mkm.test');assert.equal(calls.length,3);
 sqlite.prepare("UPDATE push_deliveries SET next_attempt=0,attempts=4 WHERE status='queued'").run();
 await deliverPush({DB:db},'https://mkm.test');
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM push_deliveries WHERE status='failed'").get().n,1);
});

test('coach can set own boy fee to 30 with an audit reason; other groups and girls stay protected',async t=>{
 const {sqlite,request,create}=fixture(t);
 const assigned=await create('groups',{name:'TEST dodijeljena'}),other=await create('groups',{name:'TEST druga'});
 sqlite.prepare('INSERT INTO coach_groups(user_id,group_id) VALUES(?,?)').run('coach',assigned);
 const boy=await create('members',{name:'TEST dječak',group_id:assigned,gender:'boy'});
 const girl=await create('members',{name:'TEST djevojčica',group_id:assigned,gender:'girl'});
 const foreign=await create('members',{name:'TEST tuđi član',group_id:other,gender:'boy'});
 const month=currentFeeMonth();
 const change={cents:3000,expected_cents:4000,effective_month:month,reason:'TEST dogovoren popust'};
 assert.equal((await request('member-fees/'+foreign,change,'coach','PATCH')).status,403);
 assert.equal((await request('member-fees/'+girl,change,'coach','PATCH')).status,400);
 for(const bad of [{...change,cents:2000},{...change,reason:''},{...change,effective_month:'2020-01'}])assert.equal((await request('member-fees/'+boy,bad,'coach','PATCH')).status,400);
 assert.equal((await request('member-fees/'+boy,change,'coach','PATCH')).status,201);
 const history=sqlite.prepare('SELECT * FROM member_fee_changes').all();assert.equal(history.length,1);assert.equal(history[0].before_cents,4000);assert.equal(history[0].cents,3000);assert.equal(history[0].actor_id,'coach');
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity='member_fee'").get().n,1);
 assert.equal((await request('member-fees/'+boy,change,'coach','PATCH')).status,409);
 const amounts=await (await request('member-fees?month='+month,undefined,'coach')).json();
 assert.equal(amounts.amounts.length,2);assert.equal(amounts.amounts.find(a=>a.member_id===boy).cents,3000);assert.equal(amounts.amounts.find(a=>a.member_id===girl).cents,0);
 for(const row of amounts.amounts)for(const field of ['paid','debt','credit','payments'])assert.equal(field in row,false);
 await create('fees/generate',{month});
 assert.equal(sqlite.prepare('SELECT cents FROM fee_charges WHERE member_id=? AND month=?').get(boy,month).cents,3000);
 assert.equal(sqlite.prepare('SELECT cents FROM fee_charges WHERE member_id=? AND month=?').get(girl,month).cents,0);
 assert.equal((await request('member-fees/'+boy,{...change,cents:4000,expected_cents:3000},'coach','PATCH')).status,409);
 assert.equal(sqlite.prepare('SELECT cents FROM fee_charges WHERE member_id=? AND month=?').get(boy,month).cents,3000);
});

test('new individual fee affects only uncharged months and keeps existing payments, debt and credit',async t=>{
 const {sqlite,request,create}=fixture(t);
 const group=await create('groups',{name:'TEST grupa'});
 const boy=await create('members',{name:'TEST član',group_id:group,gender:'boy'});
 const current=currentFeeMonth(),[year,month]=current.split('-').map(Number);
 const next=`${month===12?year+1:year}-${String(month===12?1:month+1).padStart(2,'0')}`;
 await create('fees/generate',{month:current});
 const frozen=sqlite.prepare('SELECT * FROM fee_charges').all();
 const payment=await create('payments',{member_id:boy,month:current,paid_at:current+'-01',cents:7000,method:'cash'});
 const before=sqlite.prepare('SELECT * FROM payments WHERE id=?').get(payment);
 assert.equal((await request('member-fees/'+boy,{cents:3000,expected_cents:4000,effective_month:next,reason:'TEST popust od sljedećeg mjeseca'},'admin','PATCH')).status,201);
 await create('fees/generate',{month:next});
 assert.deepEqual(sqlite.prepare('SELECT * FROM fee_charges WHERE month=?').all(current),frozen);
 assert.deepEqual(sqlite.prepare('SELECT * FROM payments WHERE id=?').get(payment),before);
 const dash=await (await request('dashboard?month='+next)).json();
 assert.equal(dash.ledger.rows.find(r=>r.member_id===boy).debt,0);assert.equal(dash.ledger.rows.find(r=>r.member_id===boy).credit,0);
 assert.equal(dash.charges[0].cents,3000);
});

test('member editing without retired family fee fields preserves historical metadata',async t=>{
 const {sqlite,request,create}=fixture(t);
 const group=await create('groups',{name:'TEST grupa'}),family=await create('families',{name:'TEST porodica'});
 const id=await create('members',{name:'TEST član',group_id:group,gender:'boy',family_id:family,fee_exempt:true,fee_note:'TEST stari dogovor'});
 assert.equal((await request('members/'+id,{name:'TEST novo ime',group_id:group,gender:'boy',active:true},'admin','PATCH')).status,200);
 const m=sqlite.prepare('SELECT family_id,fee_exempt,fee_note FROM members WHERE id=?').get(id);
 assert.deepEqual({...m},{family_id:family,fee_exempt:1,fee_note:'TEST stari dogovor'});
});

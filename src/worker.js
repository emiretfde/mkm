import {memberFeeAmounts,feeChangeRoute,feeMonthValid} from './simple-fees.js';
import {announcementRoute,deliverPush} from './announcements.js';
import {buildLedger} from './ledger.js';
import {validateCertificateDates} from './certificates.js';
import {validatePaymentCorrection} from './payment-corrections.js';
const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex = str => new Uint8Array(str.match(/../g).map(b=>parseInt(b,16)));
async function hashText(s){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));}
async function derive(pass,salt,iterations){
 const key=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(salt),iterations,hash:'SHA-256'},key,256));
}
function err(message,status=400){return Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});}
function ok(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function validDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;}
function validMonth(d){return /^\d{4}-(0[1-9]|1[0-2])$/.test(d);}
function str(v,max=150){return typeof v==='string'?v.trim().slice(0,max):'';}
function requireStr(v,max=150){const s=str(v,max);if(!s)throw Error('Obavezno polje nije popunjeno.');return s;}
async function payload(req){const raw=await req.text();if(raw.length>16000)throw Error('Zahtjev je prevelik.');try{return JSON.parse(raw)}catch{throw Error('Neispravan JSON.')}}
async function audit(db,uid,action,entity,id){await db.prepare('INSERT INTO audit_logs(id,actor_id,action,entity,entity_id) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),uid,action,entity,id).run();}
function cookieToken(req){return (req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mkm_session='))?.slice(12)||'';}
async function identity(req,db){const t=cookieToken(req);if(!/^[0-9a-f]{64}$/.test(t))return null;const h=await hashText(t);return db.prepare('SELECT u.id,u.email,u.display_name,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(h,Math.floor(Date.now()/1000)).first();}
function makeCookie(token,age){return `mkm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;}
function assertAdmin(user){if(user.role!=='admin')throw Object.assign(Error('Samo administrator može mijenjati podatke.'),{status:403});}
async function allowedGroup(db,user,gid){if(user.role==='admin')return true;return !!(await db.prepare('SELECT 1 FROM coach_groups WHERE user_id=? AND group_id=?').bind(user.id,gid).first());}
async function route(request,env,url,ctx){
 const db=env.DB, method=request.method, p=url.pathname;
 if(method!=='GET'&&method!=='HEAD'){const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return err('Neispravan izvor zahtjeva.',403);}
 if(p==='/api/health'&&method==='GET')return ok({status:'ok'});
 if(p==='/api/login'&&method==='POST'){
  const b=await payload(request),email=str(b.email,180).toLowerCase(), pass=typeof b.password==='string'?b.password:'';
  if(!email||!pass)return err('Unesi e-mail i lozinku.');
  const now=Math.floor(Date.now()/1000),attempt=await db.prepare('SELECT * FROM login_attempts WHERE email=?').bind(email).first();
  if(attempt?.blocked_until>now)return err('Previše pokušaja. Pokušaj kasnije.',429);
  const user=await db.prepare('SELECT * FROM users WHERE email=? AND active=1').bind(email).first();
  const valid=user&&pass.length<=256&&(await derive(pass,user.password_salt,user.iterations))===user.password_hash;
  if(!valid){
   const count=(attempt&&now-attempt.first_at<900?attempt.count:0)+1;
   await db.prepare('INSERT INTO login_attempts(email,count,first_at,blocked_until) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET count=excluded.count,first_at=excluded.first_at,blocked_until=excluded.blocked_until').bind(email,count,attempt&&now-attempt.first_at<900?attempt.first_at:now,count>=5?now+900:0).run();
   return err('Pogrešan e-mail ili lozinka.',401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE email=?').bind(email).run();
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),h=await hashText(token);
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(h,user.id,now+28800).run();
  return new Response(JSON.stringify({user:{id:user.id,email:user.email,name:user.display_name,role:user.role}}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':makeCookie(token,28800)}});
 }
 if(p==='/api/logout'&&method==='POST'){
  const token=cookieToken(request);if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hashText(token)).run();
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':makeCookie('',0),'Cache-Control':'no-store'}});
 }
 const user=await identity(request,db);
 const announcement=await announcementRoute(request,env,url,user,payload,ctx);
 if(announcement)return announcement;
 if(!user)return err('Prijavi se za pristup.',401);
 if(p==='/api/me'&&method==='GET')return ok({user});
 if(p==='/api/member-fees'&&method==='GET'){
  const selected=url.searchParams.get('month')||new Date().toISOString().slice(0,7);if(!feeMonthValid(selected))return err('Neispravan mjesec.');
  const members=(await db.prepare('SELECT id,group_id,active,gender FROM members WHERE active=1').all()).results;
  const ids=user.role==='admin'?null:(await db.prepare('SELECT group_id FROM coach_groups WHERE user_id=?').bind(user.id).all()).results.map(x=>x.group_id);
  return ok({amounts:await memberFeeAmounts(db,members.filter(m=>!ids||ids.includes(m.group_id)),selected)});
 }
 const feeChange=await feeChangeRoute(request,db,user,url,payload,allowedGroup);if(feeChange)return feeChange;

 // Date-only certificate register; no file uploads or public medical documents.
 if(p==='/api/certificates'&&method==='GET'){
  const rows=(await db.prepare('SELECT c.id,c.member_id,c.issued_on,c.expires_on,c.recorded_at,c.archived_at,m.group_id FROM medical_certificates c JOIN members m ON m.id=c.member_id ORDER BY c.recorded_at DESC').all()).results;
  const gids=user.role==='admin'?null:(await db.prepare('SELECT group_id FROM coach_groups WHERE user_id=?').bind(user.id).all()).results.map(r=>r.group_id);
  return ok({certificates:rows.filter(c=>!gids||gids.includes(c.group_id)).map(({group_id,...rest})=>rest)});
 }
 if(p==='/api/certificates'&&method==='POST'){
  const b=await payload(request),memberId=str(b.member_id,70),issued=str(b.issued_on,10),expires=str(b.expires_on,10);
  validateCertificateDates(issued,expires);
  const member=await db.prepare('SELECT id,group_id FROM members WHERE id=? AND active=1').bind(memberId).first();
  if(!member)return err('Aktivan član nije pronađen.',404);
  if(!(await allowedGroup(db,user,member.group_id)))return err('Nemaš dozvolu za ovu grupu.',403);
  const cid=crypto.randomUUID();
  const existing=(await db.prepare('SELECT id FROM medical_certificates WHERE member_id=? AND archived_at IS NULL').bind(memberId).all()).results;
  await db.batch([...existing.map(c=>db.prepare('UPDATE medical_certificates SET archived_at=CURRENT_TIMESTAMP WHERE id=?').bind(c.id)),db.prepare('INSERT INTO medical_certificates(id,member_id,issued_on,expires_on,recorded_by) VALUES(?,?,?,?,?)').bind(cid,memberId,issued,expires,user.id)]);
  await audit(db,user.id,'record','medical_certificate',cid);
  return ok({id:cid},201);
 }
 if(p==='/api/dashboard'&&method==='GET'){
  const admin=user.role==='admin';
  const gids=admin?null:(await db.prepare('SELECT group_id FROM coach_groups WHERE user_id=?').bind(user.id).all()).results.map(x=>x.group_id);
  const allGroups=(await db.prepare('SELECT * FROM groups ORDER BY name').all()).results;
  const groups=admin?allGroups:allGroups.filter(g=>gids.includes(g.id));
  const allMembers=(await db.prepare('SELECT * FROM members ORDER BY name').all()).results;
  const members=admin?allMembers:allMembers.filter(m=>gids.includes(m.group_id)).map(({parent_phone,fee_exempt,fee_note,family_id,...m})=>m);
  const allSessions=(await db.prepare('SELECT * FROM sessions ORDER BY held_on DESC').all()).results;
  const sessions=admin?allSessions:allSessions.filter(s=>gids.includes(s.group_id));
  const allAtt=(await db.prepare('SELECT * FROM attendance').all()).results;
  const ids=new Set(sessions.map(s=>s.id));const attendance=admin?allAtt:allAtt.filter(a=>ids.has(a.session_id));
  if(!admin)return ok({user,groups,members,sessions,attendance});
  const payments=(await db.prepare('SELECT id,member_id,month,paid_at,cents,method FROM payments ORDER BY paid_at DESC').all()).results;
  const users=(await db.prepare('SELECT id,email,display_name,role,active FROM users ORDER BY display_name').all()).results;
  const links=(await db.prepare('SELECT user_id,group_id FROM coach_groups').all()).results;
  const families=(await db.prepare('SELECT * FROM families ORDER BY name').all()).results;
  const selectedMonth=url.searchParams.get('month')||new Date().toISOString().slice(0,7);
  if(!validMonth(selectedMonth))return err('Neispravan mjesec.');
  const allCharges=(await db.prepare('SELECT member_id,month,cents,reason,id FROM fee_charges WHERE month<=? ORDER BY month').bind(selectedMonth).all()).results;
  const charges=allCharges.filter(c=>c.month===selectedMonth);
  const ledger=buildLedger(allCharges,payments,selectedMonth);
  const corrections=(await db.prepare('SELECT c.id,c.payment_id,c.actor_id,u.display_name AS actor_name,c.reason,c.before_json,c.after_json,c.corrected_at FROM payment_corrections c LEFT JOIN users u ON u.id=c.actor_id ORDER BY c.corrected_at DESC,c.rowid DESC LIMIT 500').all()).results;
  const feeChanges=(await db.prepare('SELECT f.id,f.member_id,f.effective_month,f.cents,f.before_cents,f.reason,f.created_at,u.display_name AS actor_name FROM member_fee_changes f LEFT JOIN users u ON u.id=f.actor_id ORDER BY f.rowid DESC LIMIT 500').all()).results;
  return ok({user,groups,members,sessions,attendance,payments,users,links,families,charges,ledger,corrections,feeChanges,monthlyFeeCents:4000});
 }
 if(method!=='POST'&&method!=='PATCH')return err('Nepodržana operacija.',405);
 assertAdmin(user);
 const b=await payload(request);const id=crypto.randomUUID();
 if(p==='/api/groups'&&method==='POST'){
  const name=requireStr(b.name,80);const coach=str(b.coach_name,100),days=str(b.schedule_days,100),time=str(b.schedule_time,10);
  await db.prepare('INSERT INTO groups(id,name,coach_name,schedule_days,schedule_time) VALUES(?,?,?,?,?)').bind(id,name,coach,days,time).run();await audit(db,user.id,'create','group',id);return ok({id},201);
 }
 if(p==='/api/families'&&method==='POST'){
  const name=requireStr(b.name,120);await db.prepare('INSERT INTO families(id,name) VALUES(?,?)').bind(id,name).run();
  await audit(db,user.id,'create','family',id);return ok({id},201);
 }
 if(p==='/api/fees/generate'&&method==='POST'){
  const billMonth=requireStr(b.month,7);if(!validMonth(billMonth))return err('Neispravan mjesec.');
  const members=(await db.prepare('SELECT id FROM members WHERE active=1').all()).results;
  const existing=(await db.prepare('SELECT COUNT(*) AS n FROM fee_charges WHERE month=?').bind(billMonth).first()).n;
  if(existing)return err('Za taj mjesec već postoje zaduženja; ne mijenjamo ranije obračune.',409);
  if(members.length){await db.batch(members.map(m=>db.prepare("INSERT INTO fee_charges(id,member_id,month,cents,reason,created_by) SELECT ?,id,?,CASE WHEN gender='girl' THEN 0 ELSE COALESCE((SELECT cents FROM member_fee_changes WHERE member_id=members.id AND effective_month<=? ORDER BY effective_month DESC,rowid DESC LIMIT 1),4000) END,CASE WHEN gender='girl' THEN 'djevojčica · besplatno' WHEN COALESCE((SELECT cents FROM member_fee_changes WHERE member_id=members.id AND effective_month<=? ORDER BY effective_month DESC,rowid DESC LIMIT 1),4000)=3000 THEN 'pojedinačna članarina 30 €' ELSE 'standardna članarina 40 €' END,? FROM members WHERE id=? AND active=1").bind(crypto.randomUUID(),billMonth,billMonth,billMonth,user.id,m.id)));}
  await audit(db,user.id,'generate','fee_charges',billMonth);return ok({created:members.length},201);
 }
 if(p==='/api/members'&&method==='POST'){
  const name=requireStr(b.name,120),birth=str(b.birth_date,10),group=requireStr(b.group_id,70);
  if(birth&&!validDate(birth))return err('Neispravan datum rođenja.');
  if(!(await db.prepare('SELECT 1 FROM groups WHERE id=?').bind(group).first()))return err('Grupa ne postoji.');
  const gender=['boy','girl'].includes(b.gender)?b.gender:null;
  const familyId=str(b.family_id,70)||null;
  if(familyId&&!(await db.prepare('SELECT 1 FROM families WHERE id=?').bind(familyId).first()))return err('Porodica ne postoji.');
  await db.prepare('INSERT INTO members(id,name,birth_date,group_id,parent_name,parent_phone,gender,family_id,fee_exempt,fee_note) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,name,birth,group,str(b.parent_name,120),str(b.parent_phone,40),gender,familyId,b.fee_exempt===true?1:0,str(b.fee_note,200)).run();await audit(db,user.id,'create','member',id);return ok({id},201);
 }
 if(p.startsWith('/api/members/')&&method==='PATCH'){
  const mid=p.split('/')[3];const found=await db.prepare('SELECT * FROM members WHERE id=?').bind(mid).first();if(!found)return err('Član ne postoji.',404);
  const name=requireStr(b.name,120),birth=str(b.birth_date,10),group=requireStr(b.group_id,70);if(birth&&!validDate(birth))return err('Neispravan datum.');
  if(!(await db.prepare('SELECT 1 FROM groups WHERE id=?').bind(group).first()))return err('Grupa ne postoji.');
  const gender=['boy','girl'].includes(b.gender)?b.gender:null;const familyId=Object.hasOwn(b,'family_id')?(str(b.family_id,70)||null):found.family_id;
  if(familyId&&!(await db.prepare('SELECT 1 FROM families WHERE id=?').bind(familyId).first()))return err('Porodica ne postoji.');
  await db.prepare('UPDATE members SET name=?,birth_date=?,group_id=?,parent_name=?,parent_phone=?,active=?,gender=?,family_id=?,fee_exempt=?,fee_note=? WHERE id=?').bind(name,birth,group,str(b.parent_name,120),str(b.parent_phone,40),b.active===false?0:1,gender,familyId,Object.hasOwn(b,'fee_exempt')?(b.fee_exempt===true?1:0):found.fee_exempt,Object.hasOwn(b,'fee_note')?str(b.fee_note,200):found.fee_note,mid).run();await audit(db,user.id,'update','member',mid);return ok({ok:true});
 }
 if(p==='/api/payments'&&method==='POST'){
  const member=requireStr(b.member_id,70),month=requireStr(b.month,7),paid=requireStr(b.paid_at,10),cents=Number(b.cents),method=str(b.method,10);
  if(!validMonth(month)||!validDate(paid)||!Number.isInteger(cents)||cents<=0||cents>10000000||!['cash','bank','other'].includes(method))return err('Neispravni podaci uplate.');
  if(!(await db.prepare('SELECT 1 FROM members WHERE id=?').bind(member).first()))return err('Član ne postoji.');
  await db.prepare('INSERT INTO payments(id,member_id,month,paid_at,cents,method,recorded_by) VALUES(?,?,?,?,?,?,?)').bind(id,member,month,paid,cents,method,user.id).run();await audit(db,user.id,'create','payment',id);return ok({id},201);
 }
 if(/^\/api\/payments\/[^/]+$/.test(p)&&method==='PATCH'){
  const paymentId=p.split('/')[3];
  const old=await db.prepare('SELECT id,member_id,month,paid_at,cents,method FROM payments WHERE id=?').bind(paymentId).first();
  if(!old)return err('Uplata ne postoji.',404);
  const change=validatePaymentCorrection(b,old);
  if(!(await db.prepare('SELECT 1 FROM members WHERE id=?').bind(change.after.member_id).first()))return err('Član ne postoji.',404);
  const correctionId=crypto.randomUUID();
  // D1 batch is atomic: both the corrected payment and history entry commit together.
  // Guard the original values against simultaneous changes by another administrator.
  const updated=db.prepare('UPDATE payments SET member_id=?,month=?,paid_at=?,cents=?,method=? WHERE id=? AND member_id=? AND month=? AND paid_at=? AND cents=? AND method=?').bind(change.after.member_id,change.after.month,change.after.paid_at,change.after.cents,change.after.method,paymentId,change.before.member_id,change.before.month,change.before.paid_at,change.before.cents,change.before.method);
  const history=db.prepare('INSERT INTO payment_corrections(id,payment_id,actor_id,reason,before_json,after_json) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND member_id=? AND month=? AND paid_at=? AND cents=? AND method=?)').bind(correctionId,paymentId,user.id,change.reason,JSON.stringify(change.before),JSON.stringify(change.after),paymentId,change.after.member_id,change.after.month,change.after.paid_at,change.after.cents,change.after.method);
  const result=await db.batch([updated,history]);
  if(!result[0]?.meta?.changes)return err('Uplata je u međuvremenu izmijenjena. Osvježi stranicu.',409);
  return ok({ok:true,correction_id:correctionId});
 }
 if(p==='/api/sessions'&&method==='POST'){
  const gid=requireStr(b.group_id,70),day=requireStr(b.held_on,10);
  if(!validDate(day))return err('Neispravan datum treninga.');
  const members=(await db.prepare('SELECT id FROM members WHERE group_id=? AND active=1').bind(gid).all()).results;
  if(!(await db.prepare('SELECT 1 FROM groups WHERE id=?').bind(gid).first()))return err('Grupa ne postoji.');
  const statuses=b.statuses||{};if(members.length>1000)return err('Grupa je prevelika.');
  const statements=[db.prepare('INSERT INTO sessions(id,group_id,held_on,created_by) VALUES(?,?,?,?)').bind(id,gid,day,user.id)];
  for(const m of members){const status=statuses[m.id]||'absent';if(!['present','absent','excused','late'].includes(status))return err('Neispravan status prisustva.');statements.push(db.prepare('INSERT INTO attendance(session_id,member_id,status) VALUES(?,?,?)').bind(id,m.id,status));}
  await db.batch(statements);await audit(db,user.id,'create','session',id);return ok({id},201);
 }
 if(p==='/api/users'&&method==='POST'){
  const email=requireStr(b.email,180).toLowerCase(),name=requireStr(b.name,120),password=b.password,groupId=requireStr(b.group_id,70);
  if(!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<12||password.length>128)return err('Unesi ispravan e-mail i lozinku sa najmanje 12 karaktera.');
  if(!(await db.prepare('SELECT 1 FROM groups WHERE id=?').bind(groupId).first()))return err('Grupa ne postoji.');
  const salt=hex(crypto.getRandomValues(new Uint8Array(16))), iterations=20000,hash=await derive(password,salt,iterations);
  await db.batch([db.prepare('INSERT INTO users(id,email,display_name,role,password_salt,password_hash,iterations) VALUES(?,?,?,?,?,?,?)').bind(id,email,name,'coach',salt,hash,iterations),db.prepare('INSERT INTO coach_groups(user_id,group_id) VALUES(?,?)').bind(id,groupId)]);
  await audit(db,user.id,'create','coach',id);return ok({id},201);
 }
 if(p==='/api/settings'&&method==='POST')return err('Standardna članarina je 40 €. Iznos po članu mijenja se u evidenciji članova.',410);

 return err('Nepoznata operacija.',404);
}
export default {async scheduled(event,env,ctx){ctx.waitUntil(deliverPush(env,'https://klub.fkmkm.workers.dev'));},async fetch(request,env,ctx){const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);try{return await route(request,env,url,ctx);}catch(e){if(e.status)return err(e.message,e.status);if(e.message?.includes('UNIQUE constraint'))return err('Ovaj podatak već postoji.',409);console.error(e);return err(e.message==='Obavezno polje nije popunjeno.'?e.message:'Greška na serveru.',e.message==='Obavezno polje nije popunjeno.'?400:500);}}};

const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const bad = (message,status=400) => json({error:message},status);
const text = (value,max) => typeof value==='string' && value.trim().length<=max ? value.trim() : '';
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hash = async value => b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
export function validateSubscription(value) {
 let url;
 try {url=new URL(value?.endpoint);} catch {throw Error('Neispravna prijava za obavještenja.');}
 const host=url.hostname;
 const trusted=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.notify.windows.com');
 if(url.protocol!=='https:'||url.port||url.username||url.password||!trusted||url.href.length>2048||!/^[-\w]{87}$/.test(value?.keys?.p256dh||'')||!/^[-\w]{22}$/.test(value?.keys?.auth||''))throw Error('Neispravna prijava za obavještenja.');
 return {endpoint:url.href,p256dh:value.keys.p256dh,auth:value.keys.auth};
}
export async function pushKeys(db) {
 let row=await db.prepare('SELECT public_key,private_key FROM push_config WHERE id=1').first();
 if(row)return row;
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const pub=await crypto.subtle.exportKey('raw',pair.publicKey),priv=await crypto.subtle.exportKey('jwk',pair.privateKey);
 await db.prepare('INSERT OR IGNORE INTO push_config(id,public_key,private_key) VALUES(1,?,?)').bind(b64(pub),priv.d).run();
 return db.prepare('SELECT public_key,private_key FROM push_config WHERE id=1').first();
}
export async function announcementRoute(req,env,url,user,readBody,ctx) {
 const db=env.DB,p=url.pathname,method=req.method;
 if(p==='/api/public/announcements'&&method==='GET') {
  const rows=(await db.prepare("SELECT a.id,a.title,a.body,a.created_at,g.name AS group_name FROM announcements a LEFT JOIN groups g ON g.id=a.group_id WHERE a.visibility='public' ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100").all()).results;
  return json({announcements:rows});
 }
 if(p==='/api/push/config'&&method==='GET')return json({publicKey:(await pushKeys(db)).public_key});
 if(p==='/api/push/subscriptions'&&['POST','DELETE'].includes(method)) {
  if(req.headers.get('Origin')!==url.origin||!req.headers.get('Content-Type')?.includes('application/json'))return bad('Neispravan izvor zahtjeva.',403);
  const b=await readBody(req);
  if(!b||typeof b!=='object')return bad('Neispravan zahtjev.');
  if(!/^[-\w]{43}$/.test(b.device_token||''))return bad('Neispravan uređaj.');
  const owner=await hash(b.device_token);
  if(method==='DELETE') {await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND owner_hash=?').bind(text(b.endpoint,2048),owner).run();return json({ok:true});}
  const now=Math.floor(Date.now()/1000),rate=await hash((req.headers.get('CF-Connecting-IP')||'local')+':'+Math.floor(now/60));
  const result=await db.prepare('INSERT INTO push_rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(rate,now+120).first();
  if(result.hits>20)return bad('Previše pokušaja. Sačekaj minut.',429);
  let sub;try{sub=validateSubscription(b.subscription);}catch(e){return bad(e.message);}
  const old=await db.prepare('SELECT owner_hash FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).first();
  if(old&&old.owner_hash!==owner)return bad('Ovaj uređaj je već registrovan. Isključi i ponovo uključi notifikacije.',409);
  await db.prepare('INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,owner_hash,user_id) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,user_id=excluded.user_id WHERE owner_hash=excluded.owner_hash').bind(crypto.randomUUID(),sub.endpoint,sub.p256dh,sub.auth,owner,user?.id||null).run();
  return json({ok:true},201);
 }
 if(p!=='/api/announcements')return null;
 if(!user)return bad('Prijavi se za pristup.',401);
 if(method==='GET') {
  const clause=user.role==='admin'?'1=1':"a.visibility='public' OR a.group_id IS NULL OR (a.group_id IN (SELECT group_id FROM coach_groups WHERE user_id=?))";
  let query=db.prepare(`SELECT a.id,a.title,a.body,a.visibility,a.group_id,a.created_at,g.name AS group_name FROM announcements a LEFT JOIN groups g ON g.id=a.group_id WHERE ${clause} ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100`);
  if(user.role!=='admin')query=query.bind(user.id);
  if(ctx?.waitUntil)ctx.waitUntil(deliverPush(env,url.origin).catch(()=>{}));
  return json({announcements:(await query.all()).results});
 }
 if(method!=='POST')return bad('Nepodržana operacija.',405);
 if(!['admin','coach'].includes(user.role))return bad('Nemaš dozvolu za objavu.',403);
 const b=await readBody(req),title=text(b.title,120),body=text(b.body,4000),group=text(b.group_id,70)||null;
 if(!title||!body||!['public','users'].includes(b.visibility)||typeof b.notify!=='boolean')return bad('Unesi naslov, tekst i vidljivost obavještenja.');
 if(group&&!(await db.prepare('SELECT id FROM groups WHERE id=?').bind(group).first()))return bad('Grupa ne postoji.');
 if(user.role==='coach'&&(!group||!(await db.prepare('SELECT 1 FROM coach_groups WHERE user_id=? AND group_id=?').bind(user.id,group).first())))return bad('Trener može objaviti samo za svoju grupu.',403);
 const id=crypto.randomUUID();
 const statements=[db.prepare('INSERT INTO announcements(id,title,body,visibility,group_id,author_id) VALUES(?,?,?,?,?,?)').bind(id,title,body,b.visibility,group,user.id),db.prepare('INSERT INTO audit_logs(id,actor_id,action,entity,entity_id) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'publish','announcement',id)];
 if(b.notify) {
  const audience=b.visibility==='public'?'1=1':group?"s.user_id IN (SELECT id FROM users WHERE active=1 AND (role='admin' OR id IN (SELECT user_id FROM coach_groups WHERE group_id=?)))":"s.user_id IN (SELECT id FROM users WHERE active=1)";
  let queue=db.prepare(`INSERT INTO push_deliveries(id,announcement_id,subscription_id) SELECT lower(hex(randomblob(16))),?,s.id FROM push_subscriptions s WHERE ${audience}`);
  queue=group&&b.visibility!=='public'?queue.bind(id,group):queue.bind(id);
  statements.push(queue);
 }
 await db.batch(statements);
 const count=(await db.prepare('SELECT count(*) AS n FROM push_deliveries WHERE announcement_id=?').bind(id).first()).n;
 if(count&&ctx?.waitUntil)ctx.waitUntil(deliverPush(env,url.origin).catch(()=>{}));
 return json({id,queued:count,notify:b.notify},201);
}
export async function deliverPush(env,origin) {
 const db=env.DB,now=Math.floor(Date.now()/1000);
 const jobs=(await db.prepare("SELECT d.id FROM push_deliveries d WHERE d.status='queued' AND d.next_attempt<=? AND d.lease_until<? ORDER BY d.next_attempt LIMIT 8").bind(now,now).all()).results;
 if(!jobs.length)return;
 const keys=await pushKeys(db);
 const {buildPushPayload}=await import('@block65/webcrypto-web-push');
 await Promise.all(jobs.map(async job => {
  const claim=await db.prepare("UPDATE push_deliveries SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='queued' AND lease_until<?").bind(now+120,job.id,now).run();
  if(!claim.meta?.changes)return;
  const row=await db.prepare('SELECT d.attempts,a.id AS announcement_id,a.visibility,a.group_id,s.id AS subscription_id,s.endpoint,s.p256dh,s.auth,s.user_id FROM push_deliveries d JOIN announcements a ON a.id=d.announcement_id JOIN push_subscriptions s ON s.id=d.subscription_id WHERE d.id=?').bind(job.id).first();
  if(!row)return;
  if(row.visibility==='users') {
   const u=await db.prepare('SELECT role FROM users WHERE id=? AND active=1').bind(row.user_id).first();
   const allowed=u&&(u.role==='admin'||!row.group_id||await db.prepare('SELECT 1 FROM coach_groups WHERE user_id=? AND group_id=?').bind(row.user_id,row.group_id).first());
   if(!allowed){await db.prepare("UPDATE push_deliveries SET status='skipped' WHERE id=?").bind(job.id).run();return;}
  }
  try {
   const subscription={endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}};
   validateSubscription(subscription);
   const payload=await buildPushPayload({data:{title:'MKM · Novo obavještenje',body:row.visibility==='public'?'U klubu je objavljeno novo obavještenje.':'Novo obavještenje za prijavljene korisnike.',id:row.announcement_id},options:{ttl:3600}},subscription,{subject:origin,publicKey:keys.public_key,privateKey:keys.private_key});
   const response=await fetch(row.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(6000)});
   if([404,410].includes(response.status)){await db.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(row.subscription_id).run();return;}
   if(!response.ok)throw Error('Push delivery failed');
   await db.prepare("UPDATE push_deliveries SET status='sent',lease_until=0 WHERE id=?").bind(job.id).run();
  } catch {
   await db.prepare('UPDATE push_deliveries SET status=?,next_attempt=?,lease_until=0 WHERE id=?').bind(row.attempts>=5?'failed':'queued',now+Math.min(3600,60*2**row.attempts),job.id).run();
  }
 }));
 await db.prepare('DELETE FROM push_rate_limits WHERE expires_at<?').bind(now).run();
}

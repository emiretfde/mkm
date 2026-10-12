export const standardFee=4000;
export function feeMonthValid(month){return typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month);}
export function currentFeeMonth(now=new Date()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Podgorica',year:'numeric',month:'2-digit'}).format(now);
}
export async function memberFeeAmounts(db,members,month){
 const changes=(await db.prepare('SELECT rowid AS sequence,member_id,effective_month,cents,reason FROM member_fee_changes WHERE effective_month<=? ORDER BY effective_month DESC,rowid DESC').bind(month).all()).results;
 const last=(await db.prepare('SELECT member_id,max(month) AS last_month FROM fee_charges GROUP BY member_id').all()).results;
 return members.filter(m=>m.active).map(m=>{const c=changes.find(c=>c.member_id===m.id);return {member_id:m.id,cents:m.gender==='girl'?0:(c?.cents??4000),reason:c?.reason||'',effective_month:c?.effective_month||null,last_charged_month:last.find(x=>x.member_id===m.id)?.last_month||null};});
}
export async function feeChangeRoute(request,db,user,url,readBody,allowedGroup){
 const p=url.pathname,method=request.method;
 if(!/^\/api\/member-fees\/[^/]+$/.test(p)||method!=='PATCH')return null;
 const memberId=p.split('/')[3];
 const member=await db.prepare('SELECT id,group_id,active,gender FROM members WHERE id=?').bind(memberId).first();
 if(!member||!member.active)return Response.json({error:'Aktivan član nije pronađen.'},{status:404,headers:{'Cache-Control':'no-store'}});
 if(!['admin','coach'].includes(user.role)||!await allowedGroup(db,user,member.group_id))return Response.json({error:'Možeš mijenjati članarinu samo za svoju grupu.'},{status:403,headers:{'Cache-Control':'no-store'}});
 if(member.gender==='girl')return Response.json({error:'Djevojčice su oslobođene članarine.'},{status:400,headers:{'Cache-Control':'no-store'}});
 const b=await readBody(request);
 if(!b||typeof b!=='object')return Response.json({error:'Neispravan zahtjev.'},{status:400,headers:{'Cache-Control':'no-store'}});
 const reason=typeof b.reason==='string'?b.reason.trim():'';
 if(![3000,4000].includes(b.cents)||![3000,4000].includes(b.expected_cents)||!feeMonthValid(b.effective_month)||b.effective_month<currentFeeMonth()||reason.length<5||reason.length>300)return Response.json({error:'Izaberi 30 € ili 40 €, tekući ili budući mjesec i razlog (5–300 znakova).'},{status:400,headers:{'Cache-Control':'no-store'}});
 if(b.cents===b.expected_cents)return Response.json({error:'Iznos nije promijenjen.'},{status:400,headers:{'Cache-Control':'no-store'}});
 const charged=await db.prepare('SELECT max(month) AS last_month FROM fee_charges WHERE member_id=? AND month>=?').bind(member.id,b.effective_month).first();
 if(charged?.last_month)return Response.json({error:'Za člana već postoji obračun za '+charged.last_month+'. Izaberi mjesec poslije tog obračuna.'},{status:409,headers:{'Cache-Control':'no-store'}});
 const id=crypto.randomUUID();
 const insert=db.prepare('INSERT INTO member_fee_changes(id,member_id,effective_month,cents,before_cents,reason,actor_id) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT cents FROM member_fee_changes WHERE member_id=? AND effective_month<=? ORDER BY effective_month DESC,rowid DESC LIMIT 1),4000)=? AND NOT EXISTS(SELECT 1 FROM fee_charges WHERE member_id=? AND month>=?)').bind(id,member.id,b.effective_month,b.cents,b.expected_cents,reason,user.id,member.id,b.effective_month,b.expected_cents,member.id,b.effective_month);
 const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,action,entity,entity_id) SELECT ?,?,'change','member_fee',? WHERE EXISTS(SELECT 1 FROM member_fee_changes WHERE id=?)").bind(crypto.randomUUID(),user.id,id,id);
 const result=await db.batch([insert,audit]);
 if(!result[0]?.meta?.changes)return Response.json({error:'Članarina je u međuvremenu izmijenjena. Osvježi prikaz.'},{status:409,headers:{'Cache-Control':'no-store'}});
 return Response.json({ok:true,id},{status:201,headers:{'Cache-Control':'no-store'}});
}

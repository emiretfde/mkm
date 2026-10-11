// Aggregation helpers; amounts are integer cents and balances stay per member.
export function groupBalances(groups, members, ledgerRows, charges) {
 const membership = new Map(members.map(m => [m.id, m.group_id]));
 const byGroup = new Map(groups.map(g => [g.id, {group_id:g.id,name:g.name,charged:0,paid:0,debt:0,credit:0,members:0}]));
 for (const m of members) { const row=byGroup.get(m.group_id); if(row && m.active) row.members++; }
 for (const c of charges) { const row=byGroup.get(membership.get(c.member_id)); if(row)row.charged+=Number(c.cents); }
 for (const l of ledgerRows) { const row=byGroup.get(membership.get(l.member_id)); if(!row)continue;row.paid+=Number(l.paid);row.debt+=Number(l.debt);row.credit+=Number(l.credit); }
 return [...byGroup.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function paymentHistory(payments, members, groups, {memberId='', month=''}={}) {
 const memberMap=new Map(members.map(m=>[m.id,m]));
 const groupMap=new Map(groups.map(g=>[g.id,g.name]));
 return payments.filter(p=>(!memberId||p.member_id===memberId)&&(!month||p.month===month))
  .map(p=>({...p,member_name:memberMap.get(p.member_id)?.name||'Nepoznat član',group_name:groupMap.get(memberMap.get(p.member_id)?.group_id)||'—'}))
  .sort((a,b)=>b.paid_at.localeCompare(a.paid_at)||b.created_at?.localeCompare(a.created_at||'')||0);
}
export function csvText(rows, keys) {
 const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 return '\ufeff'+[keys.map(k=>q(k[0])).join(';'),...rows.map(r=>keys.map(k=>q(r[k[1]])).join(';'))].join('\r\n');
}

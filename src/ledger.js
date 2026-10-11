// Monthly ledger: positive balance = outstanding debt; negative = credit.
// A payment is assigned to its recorded month and first settles any older debt.
// Remaining credit is automatically available for future monthly charges.
export function buildLedger(charges, payments, month) {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Neispravan mjesec.');
 const map = new Map();
 const ensure=(id)=>{if(!map.has(id))map.set(id,{member_id:id,opening:0,charge:0,paid:0,closing:0,debt:0,credit:0,applied:0});return map.get(id)};
 for(const c of charges){if(c.month>month)continue;const x=ensure(c.member_id);const v=Number(c.cents);if(!Number.isSafeInteger(v)||v<0)throw Error('Neispravno zaduženje.');if(c.month===month)x.charge+=v;else x.opening+=v;}
 for(const p of payments){if(p.month>month)continue;const x=ensure(p.member_id);const v=Number(p.cents);if(!Number.isSafeInteger(v)||v<0)throw Error('Neispravna uplata.');if(p.month===month)x.paid+=v;else x.opening-=v;}
 for(const x of map.values()){
  x.closing=x.opening+x.charge-x.paid;
  x.debt=Math.max(0,x.closing);
  x.credit=Math.max(0,-x.closing);
  x.applied=Math.min(x.charge,Math.max(0,-x.opening)+x.paid); // illustrative, not a payment allocation record
 }
 const rows=[...map.values()];
 const totals=rows.reduce((a,x)=>({charged:a.charged+x.charge,paid:a.paid+x.paid,opening:a.opening+x.opening,debt:a.debt+x.debt,credit:a.credit+x.credit}),{charged:0,paid:0,opening:0,debt:0,credit:0});
 return {rows,totals};
}

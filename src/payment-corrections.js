export function validatePaymentCorrection(body, original) {
 if (!original) throw Object.assign(Error('Uplata ne postoji.'),{status:404});
 const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
 if (reason.length < 10 || reason.length > 500) throw Object.assign(Error('Razlog ispravke mora imati od 10 do 500 znakova.'),{status:400});
 const member_id = body.member_id;
 const month = body.month;
 const paid_at = body.paid_at;
 const cents = body.cents;
 const method = body.method;
 if(typeof member_id !== 'string'||!member_id||member_id.length>70 ||
    typeof month !== 'string'||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)||
    typeof paid_at !== 'string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paid_at)||
    Number.isNaN(Date.parse(paid_at))||new Date(paid_at+'T00:00:00Z').toISOString().slice(0,10)!==paid_at||
    !Number.isInteger(cents)||cents<=0||cents>10000000||
    !['cash','bank','other'].includes(method)) throw Object.assign(Error('Neispravni podaci ispravke uplate.'),{status:400});
 const before = {member_id:original.member_id,month:original.month,paid_at:original.paid_at,cents:original.cents,method:original.method};
 const after = {member_id,month,paid_at,cents,method};
 if(Object.keys(before).every(k=>before[k]===after[k])) throw Object.assign(Error('Nijedan podatak nije promijenjen.'),{status:400});
 return {reason,before,after};
}

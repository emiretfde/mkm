export function validISODate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;}
export function certificateStatus(expiry,today){if(!expiry)return 'missing';if(expiry<today)return 'expired';const delta=(Date.parse(expiry+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;return delta<=30?'soon':'valid';}
export function validateCertificateDates(issued,expires){if(!validISODate(issued)||!validISODate(expires)||expires<issued)throw Object.assign(new Error('Provjeri datume izdavanja i isteka.'),{status:400});}
export function canAccessCertificate(user,member,assignedGroups){return user?.role==='admin'||(user?.role==='coach'&&member&&assignedGroups.includes(member.group_id));}

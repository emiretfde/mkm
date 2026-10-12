const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function announcementCards(rows) {
 if(!rows.length)return '<div class="announcement-empty"><h3>Još nema obavještenja</h3><p>Klupske novosti i važne informacije biće objavljene ovdje.</p></div>';
 return rows.map(a=>`<article class="announcement-card" id="announcement-${escape(a.id)}"><div class="announcement-meta"><span>${escape(a.group_name||'Cijeli klub')}${a.visibility==='users'?' · Samo za korisnike':''}</span><time>${escape(new Date(a.created_at.replace(' ','T')+'Z').toLocaleDateString('sr-ME',{day:'numeric',month:'long',year:'numeric'}))}</time></div><h3>${escape(a.title)}</h3><p class="announcement-body">${escape(a.body)}</p></article>`).join('');
}
export async function loadPublicAnnouncements() {
 const area=document.querySelector('#public-announcements');
 if(!area)return;
 try {
  const response=await fetch('/api/public/announcements');
  if(!response.ok)throw Error();
  const data=await response.json();
  if(area.isConnected){area.innerHTML=announcementCards(data.announcements);focusAnnouncement();const id=new URLSearchParams(location.search).get('obavjestenje');if(id&&!data.announcements.some(a=>a.id===id)){area.insertAdjacentHTML('afterbegin','<p class="muted">Za interna obavještenja potrebna je prijava ovlašćenog korisnika.</p>');}}
 } catch {if(area.isConnected)area.innerHTML='<p class="error">Obavještenja trenutno nijesu dostupna. Pokušaj ponovo kasnije.</p>';}
}
export function focusAnnouncement(){
 const id=new URLSearchParams(location.search).get('obavjestenje');
 if(id){const el=document.getElementById('announcement-'+id);if(el){el.tabIndex=-1;el.focus();el.scrollIntoView({block:'center'});}}
}
let registration;
function deviceToken() {
 let token=localStorage.getItem('mkm-push-device');
 if(!token){token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');localStorage.setItem('mkm-push-device',token);}
 return token;
}
async function pushRegistration() {
 if(!registration)registration=navigator.serviceWorker.register('/push-sw.js').then(()=>navigator.serviceWorker.ready);
 return registration;
}
async function saveSubscription(sub,method='POST') {
 const response=await fetch('/api/push/subscriptions',{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_token:deviceToken(),subscription:sub?.toJSON(),endpoint:sub?.endpoint})});
 if(!response.ok){const data=await response.json();throw Error(data.error||'Notifikacije trenutno nijesu dostupne.');}
}
export async function syncPushIdentity() {
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)||Notification.permission!=='granted')return;
 try {const sub=await (await pushRegistration()).pushManager.getSubscription();if(sub)await saveSubscription(sub);}catch{}
}
export async function mountPush(target) {
 if(!target||target.querySelector('.push-controls'))return;
 const area=document.createElement('div');area.className='push-controls';
 area.innerHTML='<button class="secondary" type="button">Uključi notifikacije</button><p class="muted" role="status"></p>';
 target.append(area);
 const button=area.querySelector('button'),status=area.querySelector('p');
 const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const home=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 if(!supported||(ios&&!home)){button.disabled=true;status.textContent=ios?'Za notifikacije prvo dodaj MKM na početni ekran i otvori ga odatle.':'Ovaj browser ne podržava notifikacije. Obavještenja možeš čitati ovdje.';return;}
 if(Notification.permission==='denied'){button.disabled=true;status.textContent='Notifikacije su blokirane. Dozvolu možeš promijeniti u podešavanjima browsera.';return;}
 let subscription=null;
 if(Notification.permission==='granted') {
  try {subscription=await (await pushRegistration()).pushManager.getSubscription();if(subscription)button.textContent='Isključi notifikacije';}catch{}
 }
 button.onclick=async()=>{
  button.disabled=true;status.textContent='';
  try {
   if(subscription){await saveSubscription(subscription,'DELETE');await subscription.unsubscribe();subscription=null;button.textContent='Uključi notifikacije';status.textContent='Notifikacije su isključene na ovom uređaju.';return;}
   // Permission is requested directly from this user click, including on iOS.
   const permission=await Notification.requestPermission();
   if(permission!=='granted'){status.textContent='Notifikacije nijesu uključene. Obavještenja možeš čitati na stranici.';return;}
   const configResponse=await fetch('/api/push/config');if(!configResponse.ok)throw Error('Notifikacije trenutno nijesu dostupne.');
   const {publicKey}=await configResponse.json();
   const key=Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   const reg=await pushRegistration();
   subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   try{await saveSubscription(subscription);}catch(error){await subscription.unsubscribe();subscription=null;throw error;}
   button.textContent='Isključi notifikacije';status.textContent='Notifikacije su uključene na ovom uređaju.';
  } catch(error){status.textContent=error.message||'Notifikacije trenutno nijesu dostupne.';}
  finally{button.disabled=Notification.permission==='denied';}
 };
}
export function announcementsScreen(groups) {
 return `<div class="panel"><h2>Objavi obavještenje</h2><form id="announcement-form"><div class="fields"><label class="field full">Naslov<input name="title" maxlength="120" required></label><label class="field full">Tekst<textarea name="body" rows="5" maxlength="4000" required></textarea></label><label class="field">Vidljivost<select name="visibility"><option value="public">Javno · svi posjetioci</option value="users">Samo za prijavljene korisnike</option></select></label><label class="field">Grupa<select name="group_id">${groups.all?'<option value="">Cijeli klub</option>':''}${groups.items.map(g=>`<option value="${escape(g.id)}">${escape(g.name)}</option>`).join('')}</select></label></div><p class="muted">Javno obavještenje može pročitati svako. U javnim objavama koristi samo klupske informacije.</p><p id="announcement-result" role="status"></p><button type="submit" ${!groups.all&&!groups.items.length?'disabled':''}>Pregledaj i objavi</button></form></div><div class="panel"><h2>Obavještenja</h2><div id="staff-announcements"><p class="muted">Učitavanje…</p></div></div>`;
}
export async function bindAnnouncements(api,post,groups) {
 const list=document.querySelector('#staff-announcements');
 const reload=async()=>{try{const data=await api('announcements');if(list.isConnected){list.innerHTML=announcementCards(data.announcements);focusAnnouncement();}}catch(error){if(list.isConnected)list.textContent=error.message;}};
 await reload();
 const form=document.querySelector('#announcement-form');if(!form)return;
 form.onsubmit=event=>{
  event.preventDefault();
  const draft=Object.fromEntries(new FormData(form));
  const dialog=document.createElement('dialog');dialog.className='install-dialog publish-dialog';
  dialog.setAttribute('aria-labelledby','publish-title');
  dialog.innerHTML=`<h2 id="publish-title">Potvrdi objavu</h2><p class="pill ${draft.visibility==='public'?'danger':''}">${draft.visibility==='public'?'Javno · dostupno svima':'Samo za prijavljene korisnike'}</p><p class="muted">${escape(groups.find(g=>g.id===draft.group_id)?.name||'Cijeli klub')}</p><h3>${escape(draft.title)}</h3><p class="announcement-body">${escape(draft.body)}</p><label class="notification-choice"><input type="checkbox" name="notify"> Poslati i kao notifikaciju korisnicima?</label><p class="muted">Stiže samo uređajima sa uključenim notifikacijama. Javne objave šalju se javnim pretplatnicima, a interne samo ovlašćenim korisnicima.</p><p role="alert" class="error" id="publish-error"></p><div class="actions"><button type="button" class="secondary" data-cancel>Odustani</button><button type="button" data-publish>Objavi</button></div>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-cancel]').onclick=()=>{dialog.close();dialog.remove();};
  dialog.addEventListener('cancel',()=>dialog.remove(),{once:true});
  dialog.querySelector('[data-publish]').onclick=async()=>{
   const button=dialog.querySelector('[data-publish]');button.disabled=true;
   try{const notify=dialog.querySelector('[name="notify"]').checked;const result=await post('announcements',{...draft,notify});dialog.close();dialog.remove();form.reset();document.querySelector('#announcement-result').textContent=notify?`Objavljeno. Notifikacija je stavljena u red za ${result.queued} uređaja.`:'Objavljeno bez slanja notifikacije.';await reload();}
   catch(error){dialog.querySelector('#publish-error').textContent=error.message;button.disabled=false;}
  };
 };
}

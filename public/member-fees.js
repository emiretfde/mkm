const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function feeCell(member,amounts){
 if(!member.active)return '—';
 if(member.gender==='girl')return '<span class="pill">Besplatno</span>';
 const fee=amounts.find(x=>x.member_id===member.id);
 return `<span>${(fee?.cents??4000)/100} €</span> <button class="secondary" type="button" data-fee-edit="${E(member.id)}">Izmijeni iznos</button>`;
}
function nextMonth(month){const [year,m]=month.split('-').map(Number);return `${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,'0')}`;}
export function bindFeeEditor({api,post,members,amounts,month,onRefresh}){
 document.querySelectorAll('[data-fee-edit]').forEach(button=>button.onclick=async()=>{
  const member=members.find(m=>m.id===button.dataset.feeEdit);if(!member||member.gender==='girl')return;
  const fee=amounts.find(a=>a.member_id===member.id);
  const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Podgorica'}).slice(0,7);
  const earliest=fee?.last_charged_month?nextMonth(fee.last_charged_month):current;
  const start=[current,month,earliest].sort().at(-1);
  const dialog=document.createElement('dialog');dialog.className='install-dialog';dialog.setAttribute('aria-labelledby','fee-edit-title');
  dialog.innerHTML=`<h2 id="fee-edit-title">Članarina · ${E(member.name)}</h2><p class="muted">Standardno 40 €. Pojedinačni popust je 30 €.</p><form id="fee-edit-form"><div class="fields"><label class="field">Od mjeseca<input type="month" name="effective_month" min="${E(start)}" value="${E(start)}" required></label><label class="field">Mjesečni iznos<select name="cents"><option value="4000">40 € · standardno</option><option value="3000">30 € · pojedinačni popust</option></select></label><label class="field full">Razlog izmjene<textarea name="reason" rows="3" minlength="5" maxlength="300" required></textarea></label></div><p class="muted">Iznos važi od izabranog mjeseca dok ga ponovo ne izmijeniš. Već obračunati mjeseci i uplate ostaju sačuvani.</p><p id="fee-edit-error" class="error" role="alert"></p><div class="actions"><button type="button" class="secondary" data-cancel>Odustani</button><button type="submit" disabled>Sačuvaj</button></div></form>`;
  document.body.append(dialog);dialog.showModal();
  const form=dialog.querySelector('form'),submit=form.querySelector('[type="submit"]'),error=form.querySelector('#fee-edit-error');let expected=null;
  const refresh=async()=>{
   const selected=form.elements.effective_month.value;submit.disabled=true;expected=null;error.textContent='';
   try{const data=await api('member-fees?month='+encodeURIComponent(selected));if(selected!==form.elements.effective_month.value||!dialog.open)return;const currentFee=data.amounts.find(x=>x.member_id===member.id);if(!currentFee)throw Error('Aktivan član nije pronađen.');expected=currentFee.cents;form.elements.cents.value=String(expected);submit.disabled=false;}
   catch(e){if(dialog.open)error.textContent=e.message;}
  };
  form.elements.effective_month.onchange=refresh;
  dialog.querySelector('[data-cancel]').onclick=()=>{dialog.close();dialog.remove();};dialog.addEventListener('cancel',()=>dialog.remove(),{once:true});
  form.onsubmit=async event=>{
   event.preventDefault();if(expected===null)return;submit.disabled=true;
   try{const body=Object.fromEntries(new FormData(form));await post('member-fees/'+encodeURIComponent(member.id),{...body,cents:Number(body.cents),expected_cents:expected},'PATCH');dialog.close();dialog.remove();await onRefresh();const message=document.querySelector('#message');if(message){message.className='success';message.textContent='Članarina je sačuvana od '+body.effective_month+'.';}}
   catch(e){error.textContent=e.message;submit.disabled=false;}
  };
  await refresh();
 });
}

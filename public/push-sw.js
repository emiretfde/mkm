self.addEventListener('push',event=>{
 let message;try{message=event.data?.json();}catch{}
 const id=typeof message?.id==='string'&&/^[a-f0-9-]{36}$/.test(message.id)?message.id:'';
 event.waitUntil(self.registration.showNotification('MKM · Novo obavještenje',{
  body:typeof message?.body==='string'?message.body.slice(0,160):'U klubu je objavljeno novo obavještenje.',
  icon:'/assets/mkm-icon-192.png',badge:'/assets/mkm-icon-192.png',tag:id||'mkm-news',
  data:{url:'/?obavjestenje='+encodeURIComponent(id)}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL(event.notification.data?.url||'/',self.location.origin);
 if(url.origin!==self.location.origin)return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  for(const client of clients)if(new URL(client.url).origin===self.location.origin){await client.navigate(url.href);return client.focus();}
  return self.clients.openWindow(url.href);
 }));
});

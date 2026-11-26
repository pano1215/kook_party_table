// 모꾸 웹 푸시 알림 서비스 워커. 파티 상세·알러지·게스트 이름은 알림 본문에 포함하지 않는다.
self.addEventListener("push",event=>{
  let data={};
  try { data=event.data?event.data.json():{}; } catch {}
  event.waitUntil(self.registration.showNotification(
    data.title || "모꾸 · 새 카드 도착",
    {body:data.body || "새로운 취향 카드가 도착했어요.",
      tag:data.tag || "mokku-card",icon:"/assets/toast-sticker.webp",
      data:{url:typeof data.url==="string" && /^\/#\/host\/[a-f0-9]{16}$/.test(data.url)?data.url:"/"}}
  ));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url || "/",self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
